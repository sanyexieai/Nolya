// Synthetic loopback only. Native share is mocked, never sent to a real account.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const jsQR=require('jsqr');
const crypto=require('node:crypto');
const photoAssets={friend:'/design/ambassador-cafe.jpg',guess:'/design/guess-outdoor.png',reverse:'/design/reverse-start-outdoor.png',self:'/design/self-result-mobile.jpg',mirror:'/design/full-mirror-main.jpg'};
const photoChecks=[];
async function installImageProbe(context){
 await context.addInitScript(()=>{
  const decoded=new Set(),pending=new Set();
  window.__shareImageProbe={exports:[],decoded:[]};
  const originalDecode=HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode=function(...args){
   const url=new URL(this.currentSrc||this.src,location.href);
   const local=url.origin===location.origin&&url.pathname.startsWith('/design/');
   if(local)pending.add(url.pathname);
   return originalDecode.apply(this,args).then(()=>{
    if(local){pending.delete(url.pathname);decoded.add(url.pathname);window.__shareImageProbe.decoded.push({path:url.pathname,width:this.naturalWidth,height:this.naturalHeight});}
   },error=>{if(local)pending.delete(url.pathname);throw error;});
  };
  const originalExport=HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL=function(type,...args){
   if(type==='image/png'&&this.width===1080&&[1080,1440,1920].includes(this.height))window.__shareImageProbe.exports.push({width:this.width,height:this.height,decoded:[...decoded],pending:[...pending]});
   return originalExport.call(this,type,...args);
  };
 });
}
async function capturePhotoPoster(page,panel,kind,url,out,filename,width=1080,height=1440){
 await panel.locator('img.share-poster').waitFor();
 await page.waitForFunction(({width,height})=>{const image=document.querySelector('img.share-poster');return image?.complete&&image.naturalWidth===width&&image.naturalHeight===height;},{width,height});
 const exported=await page.evaluate(()=>window.__shareImageProbe?.exports.at(-1));
 assert(exported,'Poster PNG must be generated through the observed real canvas renderer');
 assert(exported.decoded.includes(photoAssets[kind]),'Original artwork must finish native image.decode before PNG export');
 assert(!exported.pending.includes(photoAssets[kind]),'PNG must not export while its original artwork is still decoding');
 const scene=await panel.locator('img.share-brand-photo').evaluate(async image=>{await image.decode();const source=new URL(image.currentSrc);return {origin:source.origin,path:source.pathname,width:image.naturalWidth,height:image.naturalHeight};});
 assert.equal(scene.origin,new URL(page.url()).origin);assert.equal(scene.path,photoAssets[kind]);assert(scene.width>100&&scene.height>100,'Share panel must display the loaded original photo as well as the exported PNG');
 assert((await panel.locator('.share-brand-art figcaption').innerText()).includes('非用户照片'),'Brand artwork must not be presented as the user’s own photo');

 const event=page.waitForEvent('download');
 await panel.getByRole('link',{name:'保存分享海报',exact:true}).click();
 const download=await event;
 if(filename)await download.saveAs(path.join(out,filename));
 const png=fs.readFileSync(filename?path.join(out,filename):await download.path());
 assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.equal(png.readUInt32BE(16),width);assert.equal(png.readUInt32BE(20),height);
 // Inspect the actual downloaded file, not the preview DOM. Independently draw
 // the supplied original with the specified cover crop, then compare an inner
 // 11x11 grid away from the rounded border, text and QR. A decorative img beside
 // an otherwise plain exported poster cannot satisfy this pixel check.
 const pixels=await page.evaluate(async({data,asset,width,height})=>{
  const source=new URL(asset,location.origin);
  if(source.origin!==location.origin)throw new Error('Share artwork must be same-origin');
  const load=async src=>{const image=new Image();image.src=src;await image.decode();if(!image.naturalWidth||!image.naturalHeight)throw new Error('Decoded image is empty');return image;};
  const [poster,photo]=await Promise.all([load(data),load(source.href)]);
  const actual=document.createElement('canvas');actual.width=width;actual.height=height;const a=actual.getContext('2d');a.drawImage(poster,0,0);
  const box=height===1080?{x:100,y:240,width:390,height:350}:{x:100,y:230,width:880,height:height-960};
  const expected=document.createElement('canvas');expected.width=box.width;expected.height=box.height;const e=expected.getContext('2d');
  const scale=Math.max(box.width/photo.naturalWidth,box.height/photo.naturalHeight),sw=box.width/scale,sh=box.height/scale;
  e.drawImage(photo,(photo.naturalWidth-sw)/2,(photo.naturalHeight-sh)*.28,sw,sh,0,0,box.width,box.height);
  let matched=0,maxDifference=0;const total=121;
  for(let row=0;row<11;row++)for(let col=0;col<11;col++){
   const x=Math.floor(box.width*(.15+.07*col)),y=Math.floor(box.height*(.15+.07*row));
   const observed=a.getImageData(box.x+x,box.y+y,1,1).data,reference=e.getImageData(x,y,1,1).data;
   const difference=Math.max(...[0,1,2].map(i=>Math.abs(observed[i]-reference[i])));maxDifference=Math.max(maxDifference,difference);if(difference<=6)matched++;
  }
  const q=document.createElement('canvas');q.width=320;q.height=320;const qr=q.getContext('2d');qr.drawImage(poster,(width-320)/2,height-465,320,320,0,0,320,320);
  return {asset:source.pathname,naturalWidth:photo.naturalWidth,naturalHeight:photo.naturalHeight,box,matched,total,maxDifference,qr:Array.from(qr.getImageData(0,0,320,320).data)};
 },{data:'data:image/png;base64,'+png.toString('base64'),asset:photoAssets[kind],width,height});
 const {qr,...evidence}=pixels;
 const result={kind,file:filename||'temporary-repeat-download',width,height,sha256:crypto.createHash('sha256').update(png).digest('hex'),...evidence};
 photoChecks.push(result);fs.writeFileSync(path.join(out,'share-photo-pixel-checks.json'),JSON.stringify(photoChecks,null,2));
 assert(pixels.matched/pixels.total>=.95,`Downloaded ${kind} PNG must contain the original photograph: ${JSON.stringify(evidence)}`);
 assert.equal(jsQR(Uint8ClampedArray.from(qr),320,320)?.data,url,'Downloaded poster QR must resolve to the exact active invitation or non-private app URL');
 return result;
}
async function checkPhotoFailure(page,out){
 // Clone only this isolated synthetic owner's in-memory session. No extra
 // invitation is created, no API response is mocked, and no credentials are
 // written to artifacts. Only the explicit public image GET is delayed/failed.
 const context=await page.context().browser().newContext({storageState:await page.context().storageState(),viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 await installImageProbe(context);
 const failed=await context.newPage(),errors=[];failed.on('pageerror',error=>errors.push(error.message));
 let release;const gate=new Promise(resolve=>release=resolve);let rejectPhoto=true;
 const photoUrl=new URL(photoAssets.self,page.url()).href;
 await context.route(photoUrl,async route=>{await gate;if(rejectPhoto)await route.abort('failed');else await route.continue();});
 try{
  await failed.goto(new URL('/self/result',page.url()).href,{waitUntil:'domcontentloaded'});
  await failed.getByRole('button',{name:'分享结果',exact:true}).click();
  const panel=failed.getByRole('region',{name:'分享结果',exact:true});
  await panel.locator('.share-poster-placeholder').waitFor();
  assert(await panel.getByRole('button',{name:'保存分享海报',exact:true}).isDisabled());
  assert.equal(await panel.getByRole('link',{name:'保存分享海报',exact:true}).count(),0);
  assert.equal(await failed.evaluate(()=>window.__shareImageProbe.exports.length),0,'Pending original artwork must not produce a fallback PNG');
  await panel.screenshot({path:path.join(out,'share-photo-loading-desktop.png'),animations:'disabled'});
  release();
  await panel.getByRole('button',{name:'重新生成海报',exact:true}).waitFor();
  assert.match(await panel.innerText(),/失败|无法生成/,'Failed photo needs an honest, helpful UI');
  assert(await panel.getByRole('button',{name:'保存分享海报',exact:true}).isDisabled());
  assert.equal(await panel.locator('img.share-poster').count(),0);
  assert.equal(await panel.getByRole('button',{name:'系统分享海报',exact:true}).count(),0);
  assert.equal(await failed.evaluate(()=>window.__shareImageProbe.exports.length),0,'Failed photo must not export an image-free poster');
  assert(!/已发起保存|已交给系统分享/.test(await panel.innerText()),'Asset failure must not report save/share success');
  await panel.screenshot({path:path.join(out,'share-photo-failure-desktop.png'),animations:'disabled'});
  rejectPhoto=false;
  await panel.getByRole('button',{name:'重新生成海报',exact:true}).click();
  await capturePhotoPoster(failed,panel,'self',new URL('/',page.url()).href,out,'share-self-recovered.png');
  assert.equal(await panel.getByRole('button',{name:'重新生成海报',exact:true}).count(),0);
  await panel.screenshot({path:path.join(out,'share-photo-recovered-desktop.png'),animations:'disabled'});
  assert.deepEqual(errors,[],'Expected image failure must be handled without page errors');
 }finally{release();await context.close();}
}
module.exports=async function checkSocialShare(page,url,out){
 const panel=page.getByRole('region',{name:'分享邀请',exact:true});
 await panel.waitFor();
 const preview=panel.locator('img.share-poster');
 const reachability=[];
 async function settleScroll(locator,block='center') {
  await page.evaluate(async()=>{
   await document.fonts.ready;
   if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
  });
  await locator.evaluate((element,block)=>element.scrollIntoView({block,behavior:'instant'}),block);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const skip=await page.locator('.skip-link').evaluate(element=>({focused:element===document.activeElement,bottom:element.getBoundingClientRect().bottom}));
  assert(!skip.focused&&skip.bottom<=0,'Unfocused skip link must be offscreen, not removed or masked for screenshots');
 }
 async function reachable(locator,label,width) {
  const geometry=await locator.evaluate(element=>{
   const box=element.getBoundingClientRect();
   const nav=document.querySelector('.mobile-nav');
   const navBox=nav?.getBoundingClientRect();
   const bottom=nav&&getComputedStyle(nav).display!=='none'?navBox.top:innerHeight;
   const points=[box.left+box.width/2,box.left+Math.min(20,box.width/4),box.right-Math.min(20,box.width/4)].map(x=>[x,box.top+box.height/2]);
   return {left:box.left,right:box.right,top:box.top,bottom:box.bottom,height:box.height,width:innerWidth,usableBottom:bottom,scrollY,unobscured:points.every(([x,y])=>element.contains(document.elementFromPoint(x,y)))};
  });
  assert(geometry.left>=0&&geometry.right<=geometry.width+1,`${label} fits mobile width ${width}`);
  assert(geometry.top>=0&&geometry.bottom<=geometry.usableBottom,`${label} must be completely above fixed navigation at ${width}: ${JSON.stringify(geometry)}`);
  assert(geometry.height>=44,`${label} retains a 44px touch target`);
  assert(geometry.unobscured,`${label} is unobscured and actually clickable at ${width}`);
  assert(geometry.scrollY>0,`${label} screenshot must show the scrolled action section, not the top panel`);
  reachability.push({viewport:width,action:label,...geometry});
 }
 async function downloadPoster(filename,width,height) {
  return capturePhotoPoster(page,panel,'friend',url,out,filename,width,height);
 }
 async function inspect(width,height){
  await page.waitForFunction(({width,height})=>{const i=document.querySelector('img.share-poster');return i?.complete&&i.naturalWidth===width&&i.naturalHeight===height;},{width,height});
  const pixels=await preview.evaluate(i=>{const c=document.createElement('canvas');c.width=320;c.height=320;const x=c.getContext('2d');x.drawImage(i,(i.naturalWidth-320)/2,i.naturalHeight-465,320,320,0,0,320,320);return Array.from(x.getImageData(0,0,320,320).data);});
  assert.equal(jsQR(Uint8ClampedArray.from(pixels),320,320)?.data,url,'Actual poster QR must resolve to exact active invitation');
 }
 for(const [name,width,height,file] of [['微信好友',1080,1440,'wechat'],['朋友圈',1080,1080,'moments'],['抖音',1080,1920,'douyin'],['小红书',1080,1440,'xiaohongshu']]){
  await panel.getByRole('button',{name,exact:true}).click();await inspect(width,height);
  assert.equal(await panel.getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'true');
  assert((await panel.getByTestId('share-guide').innerText()).length>10);
  assert.equal(await panel.locator('.share-details').getAttribute('open'),null,'Detailed caveats should be collapsed initially');
  await downloadPoster(`share-${file}.png`,width,height);
 }
 // Cycle back through all real formats and repeat a download without changing
 // the poster. Repeated exports are inspected in Playwright's temporary download
 // store, not duplicated into the evidence artifact.
 for(const [name,width,height] of [['朋友圈',1080,1080],['抖音',1080,1920],['微信好友',1080,1440],['小红书',1080,1440]]){
  const before=await page.evaluate(()=>window.__shareImageProbe.exports.length);
  await panel.getByRole('button',{name,exact:true}).click();
  await page.waitForFunction(count=>window.__shareImageProbe.exports.length>count,before);
  await inspect(width,height);await downloadPoster(null,width,height);
 }
 const repeatedA=await downloadPoster(null,1080,1440),repeatedB=await downloadPoster(null,1080,1440);
 assert.equal(repeatedA.sha256,repeatedB.sha256,'Repeated save must preserve the current actual photo poster');
 const prior=await preview.getAttribute('src');
 await panel.getByRole('textbox',{name:'分享文案',exact:true}).fill('一起发现不同视角 🌿\n这是可编辑的测试文案。');
 await page.waitForFunction(old=>{const i=document.querySelector('img.share-poster');return i&&i.src!==old;},prior);await inspect(1080,1440);
 await page.evaluate(()=>{
  window.__shareProbe={mode:'cancel',calls:[],clipboard:[]};
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.__shareProbe.clipboard.push(text)}});
  Object.defineProperty(navigator,'canShare',{configurable:true,value:p=>!!p.files?.length});
  Object.defineProperty(navigator,'share',{configurable:true,value:async p=>{window.__shareProbe.calls.push({title:p.title,text:p.text,url:p.url,files:p.files?.map(f=>({name:f.name,size:f.size,type:f.type}))});if(window.__shareProbe.mode==='cancel')throw new DOMException('Cancelled','AbortError');if(window.__shareProbe.mode==='error')throw new DOMException('Failed','NotAllowedError');}});
 });
 await panel.getByRole('button',{name:'更多 / 系统',exact:true}).click();await inspect(1080,1440);
 await panel.getByRole('button',{name:'复制文案和链接',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.__shareProbe.clipboard[0]),'一起发现不同视角 🌿\n这是可编辑的测试文案。\n'+url);
 await panel.getByRole('button',{name:'系统分享链接',exact:true}).click();
 await panel.getByText('已取消系统分享，没有自动发送。',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.__shareProbe.clipboard.length),1);assert.equal(await page.evaluate(()=>window.__shareProbe.calls[0].url),url);
 await page.evaluate(()=>window.__shareProbe.mode='success');await panel.getByRole('button',{name:'系统分享海报',exact:true}).click();
 await panel.getByText('已交给系统分享。是否发送或发布，请在所选应用中确认。',{exact:true}).waitFor();
 const payload=await page.evaluate(()=>window.__shareProbe.calls[1]);assert.equal(payload.files[0].type,'image/png');assert(payload.files[0].size>10000);assert.equal(payload.url,undefined);
 await page.evaluate(()=>window.__shareProbe.mode='error');await panel.getByRole('button',{name:'系统分享链接',exact:true}).click();
 await panel.getByText('系统分享未完成。你可以复制链接或保存海报后自行分享。',{exact:true}).waitFor();
 await settleScroll(panel,'start');
 await page.screenshot({path:path.join(out,'share-desktop.png'),fullPage:true,animations:'disabled'});
 for(const width of [320,390]){
  await page.setViewportSize({width,height:844});
  await settleScroll(panel,'start');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Share overflow ${width}`);
  await page.screenshot({path:path.join(out,`share-mobile-${width}.png`),fullPage:false,animations:'disabled'});
  // Locator visibility alone can pass while a fixed bottom navigation overlays
  // the action. Scroll the real action group, verify bounding boxes and hit
  // targets, then actually save and copy at each narrow viewport.
  const actions=panel.locator('.share-export-actions');
  const save=panel.getByRole('link',{name:'保存分享海报',exact:true});
  const copy=panel.getByRole('button',{name:'复制邀请链接',exact:true});
  await settleScroll(actions);
  for(const [control,label] of [[save,'save-poster'],[copy,'copy-invitation'],[panel.getByRole('button',{name:'系统分享链接',exact:true}),'system-link'],[panel.getByRole('button',{name:'系统分享海报',exact:true}),'system-poster']]) await reachable(control,label,width);
  await downloadPoster(`share-mobile-${width}-download.png`,1080,1440);
  await panel.getByText(/已发起保存海报/).waitFor();
  await copy.click();
  await panel.getByText('链接已复制。请到目标应用自行发送。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__shareProbe.clipboard.at(-1)),url);
  await settleScroll(actions);
  await reachable(save,'save-poster-after-click',width);
  await reachable(copy,'copy-invitation-after-click',width);
  await page.screenshot({path:path.join(out,`share-mobile-${width}-actions.png`),fullPage:false,animations:'disabled'});
  const copyCaption=panel.getByRole('button',{name:'复制文案和链接',exact:true});
  await settleScroll(copyCaption);
  await reachable(copyCaption,'copy-caption-and-link',width);
  await copyCaption.click();
  await panel.getByText('文案和链接已复制。请到目标应用自行发送。',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__shareProbe.clipboard.at(-1)),'一起发现不同视角 🌿\n这是可编辑的测试文案。\n'+url);
  await settleScroll(copyCaption);
  await reachable(copyCaption,'copy-caption-after-click',width);
  await page.screenshot({path:path.join(out,`share-mobile-${width}-copy.png`),fullPage:false,animations:'disabled'});
 }
 fs.writeFileSync(path.join(out,'share-mobile-action-bounds.json'),JSON.stringify(reachability,null,2));
 await page.setViewportSize({width:1440,height:1000});
 await page.evaluate(()=>window.scrollTo({top:0,left:0,behavior:'instant'}));
 await checkPhotoFailure(page,out);
};
module.exports.installImageProbe=installImageProbe;
module.exports.capturePhotoPoster=capturePhotoPoster;

// Synthetic loopback only. Native share is mocked, never sent to a real account.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const jsQR=require('jsqr');
module.exports=async function checkSocialShare(page,url,out){
 const panel=page.getByRole('region',{name:'分享邀请',exact:true});
 await panel.waitFor();
 const preview=panel.locator('img.share-poster');
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
  const event=page.waitForEvent('download');await panel.getByRole('link',{name:'保存分享海报'}).click();
  const download=await event;const target=path.join(out,`share-${file}.png`);await download.saveAs(target);
  const png=fs.readFileSync(target);assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(png.readUInt32BE(16),width);assert.equal(png.readUInt32BE(20),height);
 }
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
 await page.evaluate(()=>document.activeElement instanceof HTMLElement&&document.activeElement.blur());
 await page.screenshot({path:path.join(out,'share-desktop.png'),fullPage:true});
 for(const width of [320,390]){
  await page.setViewportSize({width,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Share overflow${width}`);
  await page.evaluate(()=>document.activeElement instanceof HTMLElement&&document.activeElement.blur());
  await panel.evaluate(el=>el.scrollIntoView({block:'start'}));
  await page.screenshot({path:path.join(out,`share-mobile-${width}.png`),fullPage:false});
  await panel.getByRole('link',{name:'保存分享海报'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,`share-mobile-${width}-actions.png`),fullPage:false});
 }
 await page.setViewportSize({width:1440,height:1000});
};

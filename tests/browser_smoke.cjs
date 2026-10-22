// Requires Playwright plus Chromium. Uses synthetic local test data only.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const shareChecks = require('./share_browser.cjs');
(async () => {
  const base = process.env.NOLYA_TEST_BASE || 'http://127.0.0.1:3003';
  const target = new URL(base);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'Browser test is restricted to loopback synthetic services');
  assert.equal(process.env.NOLYA_SYNTHETIC_DB, '1', 'Set NOLYA_SYNTHETIC_DB=1 only for an isolated disposable database');
  const out = process.env.NOLYA_SCREENSHOTS || path.resolve('artifacts/browser');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  const context = await browser.newContext({ viewport: { width:1440, height:1000 }, deviceScaleFactor:1, reducedMotion:'reduce' });
  await shareChecks.installImageProbe(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const captures = [];
  const designPages={home:'01','self-question':'02','self-result':'03',invite:'04','friend-landing':'05','friend-question':'06','mirror-first':'07','mirror-full':'08','guess-launch':'09','guess-reveal':'10','reverse-chooser':'11','reverse-sent':'12','reverse-recipient':'13','reverse-reveal':'14','daily-unanswered':'15','daily-result':'16',journal:'17',space:'18'};
  // Capture real application state, never a mocked response or injected result.
  // Record only public route shapes: invitation tokens and recovery codes do not
  // belong in the manifest or failure diagnostics.
  async function settle(targetPage, anchor, label='current-state') {
    await targetPage.locator('.loading-state').first().waitFor({state:'hidden'});
    await targetPage.evaluate(async () => {
      await document.fonts.ready;
      if(document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await targetPage.waitForFunction(() => [...document.images].every(image => image.loading === 'lazy' || image.complete));
    assert.equal(await targetPage.locator('img').evaluateAll(images => images.filter(image => image.complete && image.naturalWidth === 0).length), 0, `Every design image must load: ${label}`);
    assert.equal(await targetPage.locator('.recovery-code').count(), 0, 'Never capture a recovery code');
    assert.equal(await targetPage.locator('input[type=password], #recover-code').evaluateAll(inputs => inputs.filter(input => input.value).length), 0, 'Capture account forms only before entering credentials');
    if(anchor) await anchor.evaluate(element => element.scrollIntoView({block:'center', behavior:'instant'}));
    else await targetPage.evaluate(() => window.scrollTo({top:0, left:0, behavior:'instant'}));
    await targetPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const skip = await targetPage.locator('.skip-link').evaluate(element => {
      const rect=element.getBoundingClientRect();
      return {bottom:rect.bottom, focused:element === document.activeElement};
    });
    assert(!skip.focused && skip.bottom <= 0, `Unfocused skip link must stay offscreen: ${label}; do not hide it in screenshot CSS`);
    const fits=await targetPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    if(!fits) {
      const diagnostic=await targetPage.evaluate(() => ({
        viewport:{width:innerWidth,height:innerHeight,scrollX,scrollY,documentWidth:document.documentElement.scrollWidth},
        elements:[...document.querySelectorAll('body *')].map(element=>{
          const box=element.getBoundingClientRect();
          if(box.right<=innerWidth+1&&box.left>=-1)return null;
          const style=getComputedStyle(element);
          return {tag:element.tagName,classes:element.getAttribute('class')||'',left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,overflowX:style.overflowX,position:style.position,ancestors:[element.parentElement,element.parentElement?.parentElement].filter(Boolean).map(parent=>({tag:parent.tagName,classes:parent.getAttribute('class')||'',overflowX:getComputedStyle(parent).overflowX,left:parent.getBoundingClientRect().left,right:parent.getBoundingClientRect().right}))};
        }).filter(Boolean)
      }));
      fs.writeFileSync(path.join(out,`${label}-overflow.json`),JSON.stringify(diagnostic,null,2));
      await targetPage.screenshot({path:path.join(out,`${label}-overflow.png`),fullPage:false,animations:'disabled'});
      await targetPage.screenshot({path:path.join(out,`${label}-overflow-full.png`),fullPage:true,animations:'disabled'});
      console.error('Overflow diagnostic '+label+' '+JSON.stringify(diagnostic));
    }
    assert(fits, `Horizontal overflow in ${label}`);
  }
  function writeManifest() {
    fs.writeFileSync(path.join(out,'design-state-manifest.json'),JSON.stringify({viewports:{desktop:{width:1440,height:1000},mobile:{width:390,height:844}},captures},null,2));
  }
  async function checkObservedGeometry(targetPage,label,size) {
    const samples=[];
    const problems=[];
    if(['account-register','account-login'].includes(label)) {
      const image=await targetPage.locator('img.account-auth-photo').evaluate(async element=>{await element.decode();const source=new URL(element.currentSrc);return {sameOrigin:source.origin===location.origin,path:source.pathname,width:element.naturalWidth,height:element.naturalHeight};});
      samples.push({check:'auth-original-artwork',image});
      if(!image.sameOrigin||image.path!=='/design/ambassador-outdoor.jpg'||image.width<100||image.height<100)problems.push('Both empty authentication modes must load the same-origin original photo');
      const auth=await targetPage.evaluate(()=>{
        const parse=value=>{const n=value.match(/[\d.]+/g).map(Number);return [n[0],n[1],n[2],n[3]??1];};
        const lum=rgb=>rgb.slice(0,3).map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
        const photo=document.querySelector('.account-auth-photo').getBoundingClientRect(),caption=document.querySelector('.account-auth-caption').getBoundingClientRect();
        const contrasts=[...document.querySelectorAll('.account-auth-caption span,.account-auth-caption h2,.account-auth-caption p,.account-card label,.account-card .button:not(:disabled)')].filter(el=>el.getClientRects().length).map(el=>{
          const stack=[];for(let n=el;n;n=n.parentElement){const style=getComputedStyle(n);if(style.backgroundImage!=='none')throw new Error('Auth text contrast requires opaque, image-free text surfaces');const bg=parse(style.backgroundColor);stack.push(bg);if(bg[3]===1)break;}
          let background=[255,255,255];for(const front of stack.reverse())background=background.map((c,i)=>front[i]*front[3]+c*(1-front[3]));
          const foreground=parse(getComputedStyle(el).color),text=background.map((c,i)=>foreground[i]*foreground[3]+c*(1-foreground[3]));
          const a=lum(text),b=lum(background);return {tag:el.tagName,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
        });
        return {photoBottom:photo.bottom,captionTop:caption.top,captionOpaque:parse(getComputedStyle(document.querySelector('.account-auth-caption')).backgroundColor)[3]===1,cardOpaque:parse(getComputedStyle(document.querySelector('.account-card')).backgroundColor)[3]===1,contrasts};
      });
      samples.push({check:'auth-legible-image-and-form',...auth});
      if(!auth.captionOpaque||!auth.cardOpaque||auth.contrasts.some(sample=>sample.ratio<4.5))problems.push('Auth caption and form text must remain on opaque high-contrast surfaces');
      if(size==='mobile'&&auth.captionTop<auth.photoBottom-.5)problems.push('Mobile auth caption must stay below the photo, not cover its face');
      // Earlier checks open independent respondent and failure-test pages.
      // Keyboard acceptance must exercise this foreground authentication page.
      await targetPage.bringToFront();
      await targetPage.getByLabel('用户名',{exact:true}).focus();
      await targetPage.keyboard.press('Tab');
      // Native focus and its rendered indicator can settle on different frames.
      // Keep the keyboard/navigation requirement; never focus the password for
      // the test or substitute a screenshot-only outline.
      let passwordFocus=false;
      try {
        await targetPage.waitForFunction(()=>{
          const element=document.querySelector('#password');
          return element===document.activeElement&&element.matches(':focus-visible')&&parseFloat(getComputedStyle(element).outlineWidth)>=2;
        },null,{timeout:5000,polling:'raf'});
        passwordFocus=true;
      } catch(error) {
        if(error.name!=='TimeoutError')throw error;
      }
      const focusDiagnostic=await targetPage.getByLabel('密码',{exact:true}).evaluate(element=>{
        const style=getComputedStyle(element),box=element.getBoundingClientRect(),active=document.activeElement;
        return {active:element===active,focused:element.matches(':focus'),focusVisible:element.matches(':focus-visible'),documentFocused:document.hasFocus(),activeTag:active?.tagName,activeId:active?.id||'',disabled:element.disabled,tabIndex:element.tabIndex,outline:{width:style.outlineWidth,style:style.outlineStyle,color:style.outlineColor,offset:style.outlineOffset},bounds:{left:box.left,right:box.right,top:box.top,bottom:box.bottom},viewport:{width:innerWidth,height:innerHeight}};
      });
      samples.push({check:'auth-password-keyboard-focus',...focusDiagnostic});
      if(!passwordFocus){
        problems.push('Auth password input must remain keyboard-reachable with a visible focus outline');
        await targetPage.screenshot({path:path.join(out,`${label}-${size}-focus-failure.png`),fullPage:false,animations:'disabled'});
        console.error('Auth focus diagnostic '+label+'-'+size+' '+JSON.stringify(focusDiagnostic));
      }
      await targetPage.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
    }
    if(label==='self-result') {
      const cards=await targetPage.locator('.self-traits > .self-trait-card').evaluateAll(elements=>elements.map(element=>{
        const title=element.querySelector('.self-trait-title').getBoundingClientRect(),value=element.querySelector('.self-trait-value').getBoundingClientRect(),description=element.querySelector('.self-trait-description')?.getBoundingClientRect(),box=element.getBoundingClientRect();
        return {dimension:element.dataset.dimension,left:box.left,right:box.right,top:box.top,bottom:box.bottom,titleBottom:title.bottom,valueTop:value.top,valueBottom:value.bottom,descriptionTop:description?.top??null};
      }));
      samples.push({check:'self-independent-labeled-trait-cards',cards});
      if(cards.length!==3||cards.some((card,index)=>card.titleBottom>card.valueTop+.5||card.descriptionTop!==null&&card.valueBottom>card.descriptionTop+.5||cards.slice(index+1).some(other=>Math.min(card.right,other.right)-Math.max(card.left,other.left)>1&&Math.min(card.bottom,other.bottom)-Math.max(card.top,other.top)>1)))problems.push('Independent result labels, values, descriptions and cards must not overlap');
    }
    if(label==='space'&&size==='mobile') {
      const cards=await targetPage.locator('.space-source-title').evaluateAll(elements=>elements.map(element=>{
        const icon=element.querySelector('.tile-icon').getBoundingClientRect();
        const text=element.querySelector(':scope > div').getBoundingClientRect();
        return {icon:{left:icon.left,right:icon.right,top:icon.top,bottom:icon.bottom},text:{left:text.left,right:text.right,top:text.top,bottom:text.bottom},overlap:Math.min(icon.right,text.right)-Math.max(icon.left,text.left)>1&&Math.min(icon.bottom,text.bottom)-Math.max(icon.top,text.top)>1};
      }));
      samples.push({check:'space-source-icons',cards});
      if(cards.length!==3||cards.some(card=>card.overlap))problems.push('Space source icons must not overlap their title/status text');
    }
    if(label==='journal'&&size==='mobile') {
      const buttons=await targetPage.locator('.journal-filters button').evaluateAll(elements=>elements.map(element=>{
        const rect=element.getBoundingClientRect();
        const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
        const lines=[];
        while(walker.nextNode()) {
          const node=walker.currentNode;
          if(!node.textContent.trim())continue;
          const range=document.createRange();range.selectNodeContents(node);
          for(const box of range.getClientRects())if(box.width>0&&box.height>0&&!lines.some(top=>Math.abs(top-box.top)<1))lines.push(box.top);
        }
        return {height:rect.height,width:rect.width,textLines:lines.length};
      }));
      samples.push({check:'journal-filter-actions',buttons});
      if(buttons.length!==2||buttons.some(button=>button.textLines!==1||button.height>60))problems.push('Journal filter actions must keep a readable single-line label, not a vertical stack');
    }
    if(['mirror-waiting','mirror-first','mirror-full'].includes(label)&&size==='mobile') {
      const strips=await targetPage.locator('.design-mirror-content .mirror-status, .design-mirror-content .next-step-banner').evaluateAll(elements=>elements.map(element=>{
        const copy=element.querySelector(element.classList.contains('mirror-status')?':scope > div:nth-child(2)':':scope > div');
        const button=element.querySelector(':scope > .button');
        const text=copy.getBoundingClientRect(),action=button.getBoundingClientRect();
        return {kind:element.classList.contains('mirror-status')?'mirror-status':'next-step',containerWidth:element.clientWidth,copyWidth:text.width,copyBottom:text.bottom,buttonTop:action.top,buttonWidth:action.width};
      }));
      samples.push({check:'mirror-mobile-stacked-strips',strips});
      if(strips.length!==2||strips.some(strip=>strip.copyWidth<strip.containerWidth*.65||strip.buttonTop<strip.copyBottom-.5))problems.push('Mobile mirror strip copy must retain readable width with its action below, not squeeze between icons and buttons');
    }
    if(['guess-reveal','reverse-reveal'].includes(label)) {
      const answers=await targetPage.locator('.reveal-comparison > div').evaluateAll(elements=>elements.map(element=>{
        const letter=element.querySelector(':scope > span');
        const wording=element.querySelector(':scope > strong');
        const glyph=letter.getBoundingClientRect(),text=wording.getBoundingClientRect();
        const style=getComputedStyle(letter);
        return {actual:element.classList.contains('actual-choice'),glyphBottom:glyph.bottom,wordingTop:text.top,glyphHeight:glyph.height,fontSize:parseFloat(style.fontSize),background:style.backgroundColor};
      }));
      samples.push({check:'reveal-answer-letters',answers});
      if(answers.length!==2||answers.some(answer=>answer.glyphBottom>answer.wordingTop+.5||answer.glyphHeight<answer.fontSize))problems.push('Reveal A/B letters must fit their own line box and not overlap answer wording');
      if(answers.some(answer=>answer.actual&&!['transparent','rgba(0, 0, 0, 0)'].includes(answer.background)))problems.push('Actual-answer glyph must not inherit the obsolete small background circle');
    }
    if(samples.length)fs.writeFileSync(path.join(out,`${label}-${size}-geometry.json`),JSON.stringify({samples,problems},null,2));
    assert.equal(problems.length,0,`${label}-${size}: ${problems.join('; ')}`);
  }
  async function captureBoth(targetPage, label, anchor) {
    const original=targetPage.viewportSize();
    for(const [size,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
      await targetPage.setViewportSize({width,height});
      await settle(targetPage,undefined,`${label}-${size}`);
      if(['account-register','account-login'].includes(label))assert(await targetPage.locator('#username,#password').evaluateAll(inputs=>inputs.length===2&&inputs.every(input=>!input.value)),'Authentication artwork captures must contain no entered credentials');
      const file=`${label}-${size}.png`;
      await targetPage.screenshot({path:path.join(out,file),fullPage:true,animations:'disabled'});
      captures.push({state:label,designPage:designPages[label]||null,size,file});
      writeManifest();
      await checkObservedGeometry(targetPage,label,size);
      if(anchor) {
        await settle(targetPage,anchor,`${label}-${size}-detail`);
        const detail=`${label}-${size}-detail.png`;
        await targetPage.screenshot({path:path.join(out,detail),fullPage:false,animations:'disabled'});
        captures.push({state:label,designPage:designPages[label]||null,size,file:detail,section:true});
        writeManifest();
      }
    }
    await targetPage.setViewportSize(original);
    await settle(targetPage,undefined,label);
  }
  try {
    await page.goto(base);
    await page.getByRole('heading', {level:1}).waitFor();
    assert(await page.locator('.hero-copy h1').evaluate(el=>Number(getComputedStyle(el).fontWeight)>=700),'Home CJK headline must retain bold hierarchy');
    // The accessibility link is hidden only when unfocused, and is functional
    // from the keyboard. Screenshot cleanup must not remove this navigation.
    await settle(page,undefined,'home-keyboard-ready');
    await page.keyboard.press('Tab');
    try {
      // Check focus and rendered geometry in one frame, after real keyboard
      // navigation. A fixed sleep or programmatic focus could conceal defects.
      await page.waitForFunction(()=>{
        const link=document.querySelector('.skip-link');
        if(!link||link!==document.activeElement||!link.matches(':focus'))return false;
        const box=link.getBoundingClientRect();
        return box.width>0&&box.height>0&&box.top>=0&&box.left>=0&&box.right<=innerWidth&&box.bottom<=innerHeight;
      },null,{timeout:5000,polling:'raf'});
    } catch(error) {
      const diagnostic=await page.locator('.skip-link').evaluate(link=>{
        const box=link.getBoundingClientRect(),style=getComputedStyle(link);
        return {active:link===document.activeElement,focused:link.matches(':focus'),documentFocused:document.hasFocus(),viewport:{width:innerWidth,height:innerHeight},bounds:{left:box.left,right:box.right,top:box.top,bottom:box.bottom,width:box.width,height:box.height},style:{top:style.top,position:style.position,display:style.display,visibility:style.visibility,transform:style.transform,transition:style.transition}};
      });
      fs.writeFileSync(path.join(out,'skip-link-focus-failure.json'),JSON.stringify(diagnostic,null,2));
      await page.screenshot({path:path.join(out,'skip-link-focus-failure.png'),fullPage:false,animations:'disabled'});
      console.error('Skip-link focus diagnostic '+JSON.stringify(diagnostic));
      throw error;
    }
    assert(await page.locator('.skip-link').evaluate(element => element === document.activeElement&&element.matches(':focus')));
    assert((await page.locator('.skip-link').boundingBox()).y >= 0);
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('#main-content')===document.activeElement,null,{timeout:5000,polling:'raf'});
    assert(await page.locator('#main-content').evaluate(element => element === document.activeElement));
    const homeTypography=[];
    for(const width of [320,390,430,1440]) {
      await page.setViewportSize({width,height:width===1440?1000:844});
      await settle(page,undefined,`home-type-${width}`);
      const type=await page.locator('.hero-copy').evaluate(element=>({headline:parseFloat(getComputedStyle(element.querySelector('h1')).fontSize),body:parseFloat(getComputedStyle(element.querySelector(':scope > p')).fontSize)}));
      const expected=width===1440?Math.min(58,Math.max(36,width*.04)):Math.min(47,Math.max(27,width*.07));
      assert(Math.abs(type.headline-expected)<.1,`Home headline at ${width} must match the scoped typography change`);
      assert.equal(type.body,width===1440?17:15,'Only mobile home copy should shrink');
      if(width!==1440){
        const actions=page.locator('.hero-actions');await actions.evaluate(element=>element.scrollIntoView({block:'center',behavior:'instant'}));
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const controls=await actions.locator('a.button').evaluateAll(elements=>elements.map(element=>{const box=element.getBoundingClientRect(),nav=document.querySelector('.mobile-nav').getBoundingClientRect();return {height:box.height,top:box.top,bottom:box.bottom,navTop:nav.top,hit:element.contains(document.elementFromPoint(box.left+box.width/2,box.top+box.height/2))};}));
        assert.equal(controls.length,2);for(const control of controls)assert(control.height>=44&&control.top>=0&&control.bottom<=control.navTop&&control.hit,`Home actions must remain usable at ${width}: ${JSON.stringify(control)}`);
        // Full-page screenshots start at scroll zero so offscreen fixed
        // accessibility links are not composited into the document capture.
        // Reachability above was still measured at the actual action scroll.
        await settle(page,undefined,`home-type-${width}-capture`);
        await page.screenshot({path:path.join(out,`home-type-mobile-${width}.png`),fullPage:true,animations:'disabled'});
      }
      homeTypography.push({width,...type});
    }
    fs.writeFileSync(path.join(out,'home-typography.json'),JSON.stringify(homeTypography,null,2));
    await captureBoth(page,'home');
    await page.getByRole('link', {name:/开始回答 8 道题/}).click();
    // Missing answer cannot advance. Previous-step edits survive back navigation.
    await page.getByRole('radio').first().waitFor();
    assert(await page.getByRole('button', {name:/下一题/}).isDisabled());
    await captureBoth(page,'self-question');
    await page.getByRole('radio').first().click();
    await page.getByRole('button', {name:/下一题/}).click();
    await page.getByRole('button', {name:/上一题/}).click();
    assert.equal(await page.getByRole('radio').first().getAttribute('aria-checked'), 'true');
    await page.getByRole('radio').first().focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('radio').nth(1).getAttribute('aria-checked'), 'true');
    // The page explicitly promises that an unfinished assessment is not saved.
    await page.reload();
    await page.getByRole('radio').first().waitFor();
    assert.equal(await page.getByRole('radio').first().getAttribute('aria-checked'), 'false');
    // Real answers produce two different stable traits (including a reverse
    // polarity) plus contextual dimensions, not an injected result fixture.
    const selfChoices=[0,0,1,1,0,1,0,1];
    for(let i=0;i<8;i++) {
      await page.getByRole('radio').first().waitFor();
      await page.getByRole('radio').nth(selfChoices[i]).click();
      await page.getByRole('button',{name:i===7?'提交并查看结果':/下一题/}).click();
    }
    await page.waitForURL('**/self/result');
    await page.locator('.design-self-result .evidence-card').waitFor();
    const latestSelfResponse=await context.request.get(base+'/api/v1/self/latest');
    assert.equal(latestSelfResponse.status(),200,'Read the actual completed self assessment for display acceptance');
    const latestSelf=await latestSelfResponse.json();
    const selfEvidence=await page.locator('.design-self-result .evidence-card').evaluate(element=>{
      const all=element.innerText;
      const cards=[...element.querySelectorAll('.self-traits > .self-trait-card')].map(card=>({
        dimension:card.dataset.dimension,title:card.querySelector('.self-trait-title').innerText.trim(),value:card.querySelector('.self-trait-value').innerText.trim(),description:card.querySelector('.self-trait-description')?.innerText.trim()||'',
        tag:card.tagName,label:card.getAttribute('aria-label'),interactive:card.matches('button,a,input,[role="radio"],[role="option"],[aria-checked],[aria-selected],.option,.selected')||!!card.querySelector('button,a,input,select,[role="radio"],[aria-checked],[aria-selected]'),cursor:getComputedStyle(card).cursor,
      }));
      return {cards,valueOccurrences:cards.map(card=>all.split(card.value).length-1),titleOccurrences:cards.map(card=>all.split(card.title).length-1)};
    });
    const selectedDimensions=[...latestSelf.dimensions.filter(item=>item.score!==0).slice(0,2),...latestSelf.dimensions.filter(item=>item.score===0).slice(0,1)];
    assert.equal(selectedDimensions.length,3,'Synthetic real answers must exercise two stable traits plus one contextual result');
    assert.equal(selectedDimensions.filter(item=>item.state==='stable').length,2);
    assert.deepEqual(selfEvidence.cards.map(card=>card.dimension),selectedDimensions.map(item=>item.dimension),'Keep all selected independent dimensions, in deterministic order');
    assert.equal(new Set(selfEvidence.cards.map(card=>card.dimension)).size,selfEvidence.cards.length,'One dimension must have exactly one result card');
    assert.equal(new Set(selfEvidence.cards.map(card=>card.title)).size,selfEvidence.cards.length,'Different traits must have distinct visible dimension labels');
    const traitNames={D1:'做事方式',D2:'表达方式',D3:'体验偏好',D4:'情绪表达'};
    assert.deepEqual(selfEvidence.cards.map(({dimension,title,value,description})=>({dimension,title,value,description})),latestSelf.observation_details.map(({dimension,title,value,description})=>({dimension,title,value,description})),'Render every actual structured observation without dropping or inventing a result');
    for(const [index,card] of selfEvidence.cards.entries()){
      const dimension=selectedDimensions[index];
      assert.equal(card.title,traitNames[dimension.dimension]);
      assert.equal(card.value,dimension.score===0?'视情境而定':'偏向'+dimension.label,'Each dimension must show only its actual calculated value, not both opposing options');
      assert(card.tag==='SECTION'&&card.label===card.title&&!card.interactive&&card.cursor!=='pointer','Trait results must be independent labeled read-only cards, not selectable answer radios');
    }
    assert(selfEvidence.valueOccurrences.every(count=>count===1)&&selfEvidence.titleOccurrences.every(count=>count===1),'Trait values and labels must not repeat as an unlabeled concatenated summary elsewhere in the result card');
    await captureBoth(page,'self-result');
    assert.equal(await page.getByRole('region',{name:'分享结果',exact:true}).count(),0);
    await page.getByRole('button',{name:'分享结果',exact:true}).click();
    const resultShare=page.getByRole('region',{name:'分享结果',exact:true});
    await resultShare.locator('img.share-poster').waitFor();
    assert.equal(await resultShare.getByRole('textbox',{name:'分享链接',exact:true}).inputValue(),base+'/');
    assert((await resultShare.innerText()).includes('不包含你的个人结果'));
    await shareChecks.capturePhotoPoster(page,resultShare,'self',base+'/',out,'share-self.png');
    await captureBoth(page,'self-result-share-preview',resultShare);
    await page.getByRole('button',{name:'收起分享预览',exact:true}).click();
    assert.equal(await page.getByRole('region',{name:'分享结果',exact:true}).count(),0);
    await page.reload();
    await page.locator('.design-self-result .evidence-card').waitFor();
    await page.goto(base+'/today');
    await page.getByRole('radio').first().waitFor();
    await captureBoth(page,'daily-unanswered');
    await page.getByRole('radio').first().click();
    await page.getByRole('button',{name:/提交答案/}).click();
    await page.locator('.saved-choice').waitFor();
    await captureBoth(page,'daily-result');
    // Invite creation, owner exclusion, independent friend consent and persistence.
    await page.goto(base+'/invite');
    await page.getByRole('button',{name:/生成朋友邀请链接|创建朋友邀请/}).waitFor();
    await captureBoth(page,'invite');
    await page.getByRole('button',{name:/生成朋友邀请链接|创建朋友邀请/}).click();
    const friendUrl = await page.getByRole('textbox',{name:'分享链接'}).inputValue();
    assert.equal(new URL(friendUrl).origin, target.origin);
    await require('./share_browser.cjs')(page,friendUrl,out);
    await page.goto(base+'/mirror');
    await page.getByText('0 / 3 个独立视角已送达',{exact:true}).waitFor();
    await captureBoth(page,'mirror-waiting');
    await page.goto(friendUrl);
    await page.getByText('这是你自己的邀请', {exact:true}).waitFor();
    const peer = await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
    await shareChecks.installImageProbe(peer);
    const friend = await peer.newPage();
    friend.on('pageerror', e => errors.push(e.message));
    await friend.goto(friendUrl);
    const start = friend.getByRole('button',{name:/说说我眼中的/});
    assert(await start.isDisabled());
    await captureBoth(friend,'friend-landing');
    await friend.getByRole('checkbox').check();
    await start.click();
    await friend.getByRole('radio').first().waitFor();
    await captureBoth(friend,'friend-question');
    for(let i=0;i<3;i++) {
      await friend.getByRole('radio').first().click();
      await friend.getByRole('button',{name:i===2?'送出我的视角':/下一题/}).click();
    }
    await friend.getByText('你的 3 个选择已保存',{exact:true}).waitFor();
    await captureBoth(friend,'friend-thanks');
    await friend.reload();
    await friend.getByText('你的 3 个选择已保存',{exact:true}).waitFor();
    await page.goto(base+'/mirror');
    await page.getByText('1 / 3 个独立视角已送达',{exact:true}).waitFor();
    await captureBoth(page,'mirror-first');
    // Guess answers are not rendered until the other identity submits a guess.
    await page.goto(base+'/guess/new');
    await page.getByRole('region',{name:'这次让朋友猜的题'}).waitFor();
    await captureBoth(page,'guess-launch');
    await page.getByText('从已答过的题里选择',{exact:true}).click();
    await page.getByRole('radio').first().click();
    await page.getByRole('button',{name:/发给朋友猜猜/}).click();
    const guessUrl = await page.getByRole('textbox',{name:'分享链接'}).inputValue();
    assert.equal(new URL(guessUrl).origin,target.origin);
    const guessShare=page.getByRole('region',{name:'分享邀请',exact:true});
    await guessShare.locator('img.share-poster').waitFor();
    await shareChecks.capturePhotoPoster(page,guessShare,'guess',guessUrl,out,'share-guess.png');
    await captureBoth(page,'guess-sent',guessShare);
    await friend.goto(guessUrl);
    await friend.getByRole('radio').first().waitFor();
    assert.equal(await friend.locator('.actual-choice').count(),0);
    assert(await friend.getByRole('button',{name:/我猜好了，揭晓答案/}).isDisabled());
    await captureBoth(friend,'guess-recipient');
    await friend.getByRole('radio').first().click();
    await friend.getByRole('button',{name:/我猜好了，揭晓答案/}).click();
    await friend.locator('.actual-choice').waitFor();
    await friend.reload();
    await friend.locator('.actual-choice').waitFor();
    await friend.locator('[data-design-page="10"]').waitFor();
    await captureBoth(friend,'guess-reveal');
    // Reverse invitations remain directed to the original owner. Create them
    // through the same consented recipient UI, without fabricating a result.
    await friend.getByRole('button',{name:/换 TA 来猜我/}).click();
    const reverseCard=friend.locator('.reverse-answer-card');
    await reverseCard.getByRole('radio').first().waitFor();
    await friend.locator('[data-design-page="11"]').waitFor();
    await captureBoth(friend,'reverse-chooser');
    await reverseCard.getByRole('radio').nth(1).click();
    await reverseCard.getByRole('button',{name:/保存我的答案，让 TA 猜/}).click();
    const reverseReady=friend.locator('.reverse-share-ready');
    const reverseShare=reverseReady.getByRole('region',{name:'分享邀请',exact:true});
    await reverseShare.locator('img.share-poster').waitFor();
    const reverseUrl=await reverseShare.getByRole('textbox',{name:'分享链接',exact:true}).inputValue();
    assert.equal(new URL(reverseUrl).origin,target.origin);
    assert((await reverseShare.innerText()).includes('仅原邀请人可以参与'));
    await friend.locator('[data-design-page="12"]').waitFor();
    await shareChecks.capturePhotoPoster(friend,reverseShare,'reverse',reverseUrl,out,'share-reverse.png');
    await captureBoth(friend,'reverse-sent',reverseReady);
    const outsider=await browser.newContext({reducedMotion:'reduce'});
    try {
      const blocked=await outsider.request.get(reverseUrl.replace('/guess/','/api/v1/guesses/'));
      assert.equal(blocked.status(),404,'A third identity cannot open a directed reverse invitation');
    } finally { await outsider.close(); }
    await page.goto(reverseUrl);
    await page.locator('[data-design-page="13"]').waitFor();
    await page.getByRole('radio').first().waitFor();
    assert.equal(await page.locator('.actual-choice').count(),0);
    await captureBoth(page,'reverse-recipient');
    await page.getByRole('radio').nth(1).click();
    await page.getByRole('button',{name:/我猜好了，揭晓答案/}).click();
    await page.locator('.actual-choice').waitFor();
    await page.locator('[data-design-page="14"]').waitFor();
    await captureBoth(page,'reverse-reveal');
    await page.reload();
    await page.locator('.actual-choice').waitFor();
    assert((await page.locator('.actual-choice').innerText()).includes('B'));
    // Return to the original guess before the subsequent revocation check.
    await friend.goto(guessUrl);
    await friend.locator('.actual-choice').waitFor();
    // Revoke with a separate explicit confirmation; existing reveal must disappear.
    await page.goto(base+'/space');
    const managedGuess = page.locator('.managed-link').filter({hasText:'1 次猜测已收到'});
    await managedGuess.getByRole('button',{name:'撤回',exact:true}).click();
    await managedGuess.getByRole('button',{name:'取消',exact:true}).click();
    await managedGuess.getByRole('button',{name:'撤回',exact:true}).click();
    await managedGuess.getByRole('button',{name:'确认撤回',exact:true}).click();
    await managedGuess.getByText('已撤回',{exact:true}).waitFor();
    await friend.reload();
    await friend.getByText(/这轮猜测已撤回|这次猜测已经结束/).waitFor();
    assert.equal(await friend.locator('.actual-choice').count(),0);
    // Invitation manager filters must preserve real state and sharing URLs.
    const guesses = page.locator('section.card').filter({has:page.getByRole('heading',{name:'我的竞猜邀请',exact:true})});
    await page.getByLabel('筛选猜测邀请').selectOption('active');
    await guesses.getByText('已加载记录中暂无此状态的邀请。',{exact:true}).waitFor();
    await page.getByLabel('筛选猜测邀请').selectOption('ended');
    await guesses.getByText('已撤回',{exact:true}).waitFor();
    const friends = page.locator('section.card').filter({has:page.getByRole('heading',{name:'我的朋友邀请',exact:true})});
    await page.getByLabel('筛选朋友邀请').selectOption('active');
    await friends.getByRole('button',{name:'分享链接',exact:true}).click();
    assert.equal(await friends.getByRole('textbox',{name:'分享链接'}).inputValue(),friendUrl);
    await friends.getByRole('button',{name:'收起',exact:true}).click();
    await peer.close();
    // Complete the mirror with two more genuinely independent browser sessions.
    // This happens after active-invitation filtering because a full invite is
    // deliberately no longer active.
    for(let response=0;response<2;response++) {
      const independent=await browser.newContext({reducedMotion:'reduce'});
      try {
        const respondent=await independent.newPage();
        respondent.on('pageerror',e=>errors.push(e.message));
        await respondent.goto(friendUrl);
        await respondent.getByRole('checkbox').check();
        await respondent.getByRole('button',{name:/说说我眼中的/}).click();
        for(let i=0;i<3;i++) {
          await respondent.getByRole('radio').nth((i+response)%2).click();
          await respondent.getByRole('button',{name:i===2?'送出我的视角':/下一题/}).click();
        }
        await respondent.getByText('你的 3 个选择已保存',{exact:true}).waitFor();
      } finally { await independent.close(); }
    }
    await page.goto(base+'/mirror');
    await page.getByText('3 / 3 个独立视角已送达',{exact:true}).waitFor();
    await captureBoth(page,'mirror-full');
    await page.getByRole('button',{name:'分享结果',exact:true}).click();
    const mirrorShare=page.getByRole('region',{name:'分享结果',exact:true});
    assert.equal(await mirrorShare.getByRole('textbox',{name:'分享链接',exact:true}).inputValue(),base+'/');
    await shareChecks.capturePhotoPoster(page,mirrorShare,'mirror',base+'/',out,'share-mirror.png');
    await captureBoth(page,'mirror-share-preview',mirrorShare);
    await page.getByRole('button',{name:'收起分享预览',exact:true}).click();
    await page.reload();
    await page.getByText('3 / 3 个独立视角已送达',{exact:true}).waitFor();
    // One-record history, a genuine second assessment, and comparison details.
    await page.goto(base+'/self/history');
    await page.getByRole('heading',{name:'全部 1 次记录',exact:true}).waitFor();
    await captureBoth(page,'history-first');
    await page.getByRole('link',{name:'再做一次镜像',exact:true}).click();
    for(let i=0;i<8;i++) {
      await page.getByRole('radio').nth(1).click();
      await page.getByRole('button',{name:i===7?'提交并查看结果':/下一题/}).click();
    }
    await page.waitForURL('**/self/result');
    await page.locator('.design-self-result .evidence-card').waitFor();
    await page.goto(base+'/self/history');
    await page.getByRole('heading',{name:'全部 2 次记录',exact:true}).waitFor();
    await page.getByLabel('选择对比记录').selectOption({index:0});
    assert.equal(await page.locator('.history-dimensions article').count(),4);
    await page.locator('.history-entry summary').first().click();
    assert.equal(await page.locator('.history-entry').first().getAttribute('open'),'');
    await captureBoth(page,'history-comparison');
    await page.reload();
    await page.getByRole('heading',{name:'全部 2 次记录',exact:true}).waitFor();
    // Filter the real daily A answer, then reset without deleting it.
    await page.goto(base+'/journal');
    await page.locator('.journal-entry').waitFor();
    await captureBoth(page,'journal');
    await page.getByLabel('筛选选择').selectOption('B');
    await page.getByRole('button',{name:'筛选记录',exact:true}).click();
    await page.getByText('没有符合筛选条件的记录',{exact:true}).waitFor();
    await page.getByRole('button',{name:'重置',exact:true}).click();
    await page.locator('.journal-entry').waitFor();
    await page.getByLabel('开始日期',{exact:true}).fill('2000-01-01');
    await page.getByLabel('结束日期',{exact:true}).fill('2000-01-02');
    await page.getByRole('button',{name:'筛选记录',exact:true}).click();
    await page.getByText('没有符合筛选条件的记录',{exact:true}).waitFor();
    await page.getByRole('button',{name:'重置',exact:true}).click();
    await page.locator('.journal-entry').waitFor();
    // Upgrade the synthetic guest and verify the completed assessment remains.
    await page.goto(base+'/space');
    await page.getByRole('heading',{level:1}).waitFor();
    await captureBoth(page,'space');
    await page.goto(base+'/account');
    await page.getByLabel('用户名',{exact:true}).waitFor();
    await captureBoth(page,'account-register');
    await page.goto(base+'/account?mode=login');
    await page.getByRole('button',{name:'登录账户',exact:true}).waitFor();
    await captureBoth(page,'account-login');
    await page.goto(base+'/account');
    const username = 'qa_'+Date.now();
    await page.getByLabel('用户名',{exact:true}).fill(username);
    await page.getByLabel('密码',{exact:true}).fill('Synthetic-Only-Password-2026');
    await page.getByRole('button',{name:'注册账户并保留记录'}).click();
    await page.waitForURL('**/space');
    await page.goto(base+'/account');
    await page.getByRole('button',{name:'退出登录',exact:true}).waitFor();
    await captureBoth(page,'account-security');
    await page.goto(base+'/self/result');
    await page.locator('.design-self-result .evidence-card').waitFor();
    // Two authenticated contexts prove password rotation and logout-all invalidate
    // other sessions. Recovery codes stay in memory only: never log/screenshot them.
    const otherContext = await browser.newContext();
    const other = await otherContext.newPage();
    other.on('pageerror', e => errors.push(e.message));
    async function login(targetPage, password) {
      await targetPage.goto(base+'/account?mode=login');
      await targetPage.getByLabel('用户名',{exact:true}).fill(username);
      await targetPage.getByLabel('密码',{exact:true}).fill(password);
      await targetPage.getByRole('button',{name:'登录账户',exact:true}).click();
      await targetPage.waitForURL('**/space');
      await targetPage.goto(base+'/account');
      await targetPage.getByRole('button',{name:'退出登录',exact:true}).waitFor();
    }
    await login(other,'Synthetic-Only-Password-2026');
    await page.goto(base+'/account');
    const security = page.getByRole('region',{name:'账户安全',exact:true});
    await security.getByLabel('当前密码',{exact:true}).fill('Synthetic-Only-Password-2026');
    await security.getByLabel('新密码',{exact:true}).fill('Synthetic-Changed-Password-2026');
    await security.getByLabel('再次输入新密码',{exact:true}).fill('Synthetic-Changed-Password-2026');
    await security.getByRole('button',{name:'更新密码',exact:true}).click();
    await security.getByText('密码已更新，其他设备已退出登录，旧恢复码已失效。请重新生成恢复码。',{exact:true}).waitFor();
    await other.goto(base+'/account?mode=login');
    await other.getByRole('button',{name:'登录账户',exact:true}).waitFor();
    await login(other,'Synthetic-Changed-Password-2026');
    await security.getByLabel('当前密码',{exact:true}).fill('Synthetic-Changed-Password-2026');
    await security.getByRole('button',{name:'生成新的恢复码',exact:true}).click();
    await security.getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(await security.locator('.recovery-code').count(),0);
    await security.getByRole('button',{name:'生成新的恢复码',exact:true}).click();
    await security.getByRole('button',{name:'确认生成',exact:true}).click();
    let recoveryCode = await security.getByRole('textbox',{name:'分享链接'}).inputValue();
    assert(recoveryCode.length > 0,'Expected one-time synthetic recovery code');
    await security.getByRole('button',{name:'我已安全保存，隐藏恢复码',exact:true}).click();
    assert.equal(await security.locator('.recovery-code').count(),0);
    await security.getByText('退出所有设备',{exact:true}).click();
    await security.getByRole('button',{name:'确认退出所有设备',exact:true}).click();
    await page.getByLabel('用户名',{exact:true}).waitFor();
    await other.goto(base+'/account?mode=login');
    await other.getByRole('button',{name:'登录账户',exact:true}).waitFor();
    await otherContext.close();
    await page.goto(base+'/recover');
    await page.getByLabel('恢复码',{exact:true}).waitFor();
    await captureBoth(page,'recover');
    await page.getByLabel('用户名',{exact:true}).fill(username);
    await page.getByLabel('恢复码',{exact:true}).fill(recoveryCode);
    await page.getByLabel('新密码',{exact:true}).fill('Synthetic-Recovered-Password-2026');
    await page.getByLabel('再次输入新密码',{exact:true}).fill('Synthetic-Recovered-Password-2026');
    await page.getByRole('button',{name:'重置账户密码',exact:true}).click();
    await page.getByRole('button',{name:'前往登录',exact:true}).waitFor();
    recoveryCode = '';
    await captureBoth(page,'recover-success');
    await page.getByRole('button',{name:'前往登录',exact:true}).click();
    await login(page,'Synthetic-Recovered-Password-2026');
    await page.goto(base+'/self/history');
    await page.getByRole('heading',{name:'全部 2 次记录',exact:true}).waitFor();
    for(const [route,label] of [['/help','help'],['/not-a-real-page','not-found']]) {
      await page.goto(base+route);
      await page.getByRole('main').waitFor();
      await captureBoth(page,label);
    }
    for(const route of ['/journal','/mirror','/invite','/guess/new','/space','/account']) {
      await page.goto(base+route);
      await page.getByRole('heading',{level:1}).waitFor();
      await page.waitForTimeout(200);
      if(await page.locator('body').innerText().then(t=>t.includes('Unexpected Application Error'))) throw new Error('Route failed '+route);
    }
    await page.setViewportSize({width:390,height:844});
    for(const [route,label] of [['/','home'],['/self/result','self-result'],['/today','daily-result'],['/space','space']]) {
      await page.goto(base+route);
      await page.getByRole('heading',{level:1}).waitFor();
      await page.waitForTimeout(300);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
      if(overflow) {
        const bounds = await page.evaluate(() => [...document.querySelectorAll('body *')]
          .map(el => { const r = el.getBoundingClientRect(); return {tag:el.tagName,classes:el.className,left:r.left,right:r.right,width:r.width}; })
          .filter(r => r.right > innerWidth + 1 || r.left < -1));
        await page.screenshot({path:path.join(out,label+'-mobile-overflow.png'),fullPage:true});
        throw new Error('Horizontal overflow '+route+' '+JSON.stringify(bounds));
      }
      // Read computed styles after mobile overrides: only functional text, never
      // input values or recovery-code content. Composite ancestor backgrounds,
      // including gradient stops/interpolation, rather than misreading white
      // text on a gradient as white text on its transparent fallback color.
      const contrastSelectors = label === 'space'
        ? ['.space-return-copy p','.space-card h2','.space-card p','.space-source-status','.tile-action','.space-next-card p','.space-privacy-panel p','.managed-link > div:first-child','.link-actions button','.privacy-note','.site-footer','.mobile-nav a']
        : label === 'home'
          ? ['.hero-copy > p','.micro-benefits','.step-card p','.home-bottom p','.daily-teaser','.site-footer','.mobile-nav a']
          : label === 'daily-result'
            ? ['.daily-editorial-heading p','.saved-choice strong','.saved-choice > span:last-child','.pulse-evidence-note','.pulse-timestamp','.crowd-waiting p','.crowd-card > small','.crowd-row > div:first-child','.privacy-note','.site-footer'] : [];
      const contrasts = await page.evaluate(selectors => {
        const parse = value => { const n=value.match(/[\d.]+/g).map(Number); return [n[0],n[1],n[2],n[3]??1]; };
        const over = (front,back) => { const a=front[3]+back[3]*(1-front[3]); return [...front.slice(0,3).map((c,i)=>(c*front[3]+back[i]*back[3]*(1-front[3]))/a),a]; };
        const lum = rgb => rgb.slice(0,3).map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
        return selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(el=>el.getClientRects().length&&!el.disabled).map(el=>{
          const stack=[];
          for(let node=el;node;node=node.parentElement) {
            const style=getComputedStyle(node);
            const layer={color:parse(style.backgroundColor),image:[]};
            if(style.backgroundImage!=='none') {
              const stops=(style.backgroundImage.match(/rgba?\([^)]+\)/g)||[]).map(parse);
              if(!style.backgroundImage.includes('gradient(')||!stops.length) throw new Error('Contrast needs rendered background sampling for '+selector);
              layer.image.push(...stops);
              for(let stop=1;stop<stops.length;stop++) for(let step=1;step<16;step++) {
                const t=step/16;
                layer.image.push(stops[stop-1].map((value,i)=>value+(stops[stop][i]-value)*t));
              }
            }
            stack.push(layer);
          }
          let backgrounds=[[255,255,255,1]];
          for(const layer of stack.reverse()) {
            backgrounds=backgrounds.map(back=>over(layer.color,back));
            if(layer.image.length) backgrounds=backgrounds.flatMap(back=>layer.image.map(front=>over(front,back)));
          }
          const color=parse(getComputedStyle(el).color);
          const ratio=Math.min(...backgrounds.map(background=>{
            const a=lum(over(color,background)),b=lum(background);
            return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
          }));
          return {selector,ratio};
        }));
      }, contrastSelectors);
      for(const sample of contrasts) assert(sample.ratio>=4.5, `Normal text contrast ${route} ${sample.selector}: ${sample.ratio.toFixed(2)}:1`);
      if(contrastSelectors.length) assert(contrasts.length>0,'Expected functional contrast samples '+route);
      const navClearance = await page.evaluate(() => {
        const nav=document.querySelector('.mobile-nav');
        return parseFloat(getComputedStyle(document.body).paddingBottom)-nav.getBoundingClientRect().height;
      });
      assert(navClearance>=16,'Bottom scroll clearance must exceed fixed navigation by16px');
      await settle(page);
      await page.screenshot({path:path.join(out,label+'-mobile-contrast.png'),fullPage:true,animations:'disabled'});
    }
    for(const width of [320,430,768,1440]) {
      await page.setViewportSize({width,height:width<768?844:1000});
      for(const route of ['/','/self','/invite','/mirror','/space','/self/result','/self/history','/guess/new','/today','/journal','/account','/recover','/help','/not-a-real-page']) {
        await page.goto(base+route);
        await page.getByRole('main').waitFor();
        await page.locator('.loading-state').first().waitFor({state:'hidden'});
        await page.waitForFunction(()=>[...document.images].every(image=>image.loading==='lazy'||image.complete));
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Design width overflow ${width} ${route}`);
        assert.equal(await page.locator('img').evaluateAll(images=>images.filter(image=>image.complete&&image.naturalWidth===0).length),0);
      }
    }
    const expectedStates=['home','self-question','self-result','self-result-share-preview','invite','friend-landing','friend-question','friend-thanks','mirror-waiting','mirror-first','mirror-full','mirror-share-preview','guess-launch','guess-sent','guess-recipient','guess-reveal','reverse-chooser','reverse-sent','reverse-recipient','reverse-reveal','daily-unanswered','daily-result','journal','space','history-first','history-comparison','account-register','account-login','account-security','recover','recover-success','help','not-found'];
    for(const state of expectedStates) for(const size of ['desktop','mobile']) assert(captures.some(capture=>capture.state===state&&capture.size===size&&!capture.section),`Missing ${state} ${size} acceptance image`);
    assert.equal(new Set(captures.map(capture=>capture.designPage).filter(Boolean)).size,18,'Every original Page01–18 requires a desktop and mobile capture');
    writeManifest();
    if(errors.length)throw new Error('Browser errors: '+errors.join(';'));
    console.log(JSON.stringify({status:'passed',checks:['home_bold_cjk_typography','self_keyboard_radio','self_required_answer','self_back_preserves_selection','self_interruption_resets','self_8_answers','self_refresh_persistence','daily_vote','friend_consent_owner_exclusion','friend_submission_refresh','mirror_one_response','guess_hidden_until_submit','reveal_refresh','revoke_cancel_confirm_hides_reveal','guest_registration_preserves_self','invitation_filters_and_share_url','history_repeat_compare_refresh','journal_choice_date_reset','password_rotates_sessions','recovery_confirm_hide','logout_all_sessions','recovery_and_relogin_preserve_history','6_secondary_routes','4_mobile_no_overflow','mobile_computed_text_contrast','fixed_nav_scroll_clearance','responsive_design_320_430_768_1440','design_assets_loaded','result_share_explicit_preview_app_link','share_four_platform_png_downloads','share_real_qr_decode','share_caption_edit','share_native_mock_cancel_success_error','share_mobile_no_overflow','share_mobile_visible_unobscured_download_copy','keyboard_skip_link_functional_hidden_when_unfocused','all_design_states_desktop_mobile','mirror_three_independent_responses','reverse_directed_access','reverse_chooser_sent_recipient_reveal','space_icon_text_no_overlap','journal_mobile_single_line_filter_actions','reveal_answer_letters_no_overlap','mirror_mobile_readable_stacked_strips','share_original_photo_pixels_in_downloaded_png','share_native_decode_before_png','share_photo_asset_failure_retry','share_repeated_platform_cycles_and_exports','share_all_five_kinds_photo_posters','auth_original_photo_and_contrast','auth_mobile_photo_caption_no_overlap','home_mobile_type_smaller_desktop_unchanged','self_independent_labeled_traits_without_repeated_or_opposing_values'],page_errors:errors,screenshots:out}));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e.stack);process.exitCode=1});

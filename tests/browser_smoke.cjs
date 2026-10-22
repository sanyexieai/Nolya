// Requires Playwright plus Chromium. Uses synthetic local test data only.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const base = process.env.NOLYA_TEST_BASE || 'http://127.0.0.1:3003';
  const target = new URL(base);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname), 'Browser test is restricted to loopback synthetic services');
  assert.equal(process.env.NOLYA_SYNTHETIC_DB, '1', 'Set NOLYA_SYNTHETIC_DB=1 only for an isolated disposable database');
  const out = process.env.NOLYA_SCREENSHOTS || path.resolve('artifacts/browser');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
  const context = await browser.newContext({ viewport: { width:1440, height:1000 }, deviceScaleFactor:1, reducedMotion:'reduce' });
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
    assert(await targetPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Horizontal overflow in ${label}`);
  }
  function writeManifest() {
    fs.writeFileSync(path.join(out,'design-state-manifest.json'),JSON.stringify({viewports:{desktop:{width:1440,height:1000},mobile:{width:390,height:844}},captures},null,2));
  }
  async function captureBoth(targetPage, label, anchor) {
    const original=targetPage.viewportSize();
    for(const [size,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
      await targetPage.setViewportSize({width,height});
      await settle(targetPage,undefined,`${label}-${size}`);
      const file=`${label}-${size}.png`;
      await targetPage.screenshot({path:path.join(out,file),fullPage:true,animations:'disabled'});
      captures.push({state:label,designPage:designPages[label]||null,size,file});
      writeManifest();
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
    await page.keyboard.press('Tab');
    assert(await page.locator('.skip-link').evaluate(element => element === document.activeElement));
    assert((await page.locator('.skip-link').boundingBox()).y >= 0);
    await page.keyboard.press('Enter');
    assert(await page.locator('#main-content').evaluate(element => element === document.activeElement));
    await captureBoth(page,'home');
    await page.getByRole('link', {name:/开始我的第一次镜像/}).click();
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
    for(let i=0;i<8;i++) {
      await page.getByRole('radio').first().waitFor();
      await page.getByRole('radio').nth(i%2).click();
      await page.getByRole('button',{name:i===7?'看看我的第一张镜像':/下一题/}).click();
    }
    await page.waitForURL('**/self/result');
    await page.locator('.design-self-result .evidence-card').waitFor();
    await captureBoth(page,'self-result');
    assert.equal(await page.getByRole('region',{name:'分享发现',exact:true}).count(),0);
    await page.getByRole('button',{name:'分享这次发现',exact:true}).click();
    const resultShare=page.getByRole('region',{name:'分享发现',exact:true});
    await resultShare.locator('img.share-poster').waitFor();
    assert.equal(await resultShare.getByRole('textbox',{name:'分享链接',exact:true}).inputValue(),base+'/');
    assert((await resultShare.innerText()).includes('不包含你的个人结果'));
    await captureBoth(page,'self-result-share-preview',resultShare);
    await page.getByRole('button',{name:'收起分享预览',exact:true}).click();
    assert.equal(await page.getByRole('region',{name:'分享发现',exact:true}).count(),0);
    await page.reload();
    await page.locator('.design-self-result .evidence-card').waitFor();
    await page.goto(base+'/today');
    await page.getByRole('radio').first().waitFor();
    await captureBoth(page,'daily-unanswered');
    await page.getByRole('radio').first().click();
    await page.getByRole('button',{name:/留下今天的选择/}).click();
    await page.locator('.saved-choice').waitFor();
    await captureBoth(page,'daily-result');
    // Invite creation, owner exclusion, independent friend consent and persistence.
    await page.goto(base+'/invite');
    await page.getByRole('button',{name:/生成朋友邀请链接|邀请朋友选一选/}).waitFor();
    await captureBoth(page,'invite');
    await page.getByRole('button',{name:/生成朋友邀请链接|邀请朋友选一选/}).click();
    const friendUrl = await page.getByRole('textbox',{name:'分享链接'}).inputValue();
    assert.equal(new URL(friendUrl).origin, target.origin);
    await require('./share_browser.cjs')(page,friendUrl,out);
    await page.goto(base+'/mirror');
    await page.getByText('0 / 3 个独立视角已送达',{exact:true}).waitFor();
    await captureBoth(page,'mirror-waiting');
    await page.goto(friendUrl);
    await page.getByText('这是你自己的邀请', {exact:true}).waitFor();
    const peer = await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
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
    const guesses = page.locator('section.card').filter({has:page.getByRole('heading',{name:'猜猜我的选择',exact:true})});
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
    await page.reload();
    await page.getByText('3 / 3 个独立视角已送达',{exact:true}).waitFor();
    // One-record history, a genuine second assessment, and comparison details.
    await page.goto(base+'/self/history');
    await page.getByRole('heading',{name:'全部 1 次记录',exact:true}).waitFor();
    await captureBoth(page,'history-first');
    await page.getByRole('link',{name:'再做一次镜像',exact:true}).click();
    for(let i=0;i<8;i++) {
      await page.getByRole('radio').nth(1).click();
      await page.getByRole('button',{name:i===7?'看看我的第一张镜像':/下一题/}).click();
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
    await page.getByText('没有符合筛选条件的选择',{exact:true}).waitFor();
    await page.getByRole('button',{name:'重置',exact:true}).click();
    await page.locator('.journal-entry').waitFor();
    await page.getByLabel('开始日期',{exact:true}).fill('2000-01-01');
    await page.getByLabel('结束日期',{exact:true}).fill('2000-01-02');
    await page.getByRole('button',{name:'筛选记录',exact:true}).click();
    await page.getByText('没有符合筛选条件的选择',{exact:true}).waitFor();
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
    await page.getByRole('button',{name:'登录我的空间',exact:true}).waitFor();
    await captureBoth(page,'account-login');
    await page.goto(base+'/account');
    const username = 'qa_'+Date.now();
    await page.getByLabel('用户名',{exact:true}).fill(username);
    await page.getByLabel('密码',{exact:true}).fill('Synthetic-Only-Password-2026');
    await page.getByRole('button',{name:'创建账户，保存我的选择'}).click();
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
      await targetPage.getByRole('button',{name:'登录我的空间',exact:true}).click();
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
    await other.getByRole('button',{name:'登录我的空间',exact:true}).waitFor();
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
    await other.getByRole('button',{name:'登录我的空间',exact:true}).waitFor();
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
    const expectedStates=['home','self-question','self-result','self-result-share-preview','invite','friend-landing','friend-question','friend-thanks','mirror-waiting','mirror-first','mirror-full','guess-launch','guess-sent','guess-recipient','guess-reveal','reverse-chooser','reverse-sent','reverse-recipient','reverse-reveal','daily-unanswered','daily-result','journal','space','history-first','history-comparison','account-register','account-login','account-security','recover','recover-success','help','not-found'];
    for(const state of expectedStates) for(const size of ['desktop','mobile']) assert(captures.some(capture=>capture.state===state&&capture.size===size&&!capture.section),`Missing ${state} ${size} acceptance image`);
    assert.equal(new Set(captures.map(capture=>capture.designPage).filter(Boolean)).size,18,'Every original Page01–18 requires a desktop and mobile capture');
    writeManifest();
    if(errors.length)throw new Error('Browser errors: '+errors.join(';'));
    console.log(JSON.stringify({status:'passed',checks:['home_bold_cjk_typography','self_keyboard_radio','self_required_answer','self_back_preserves_selection','self_interruption_resets','self_8_answers','self_refresh_persistence','daily_vote','friend_consent_owner_exclusion','friend_submission_refresh','mirror_one_response','guess_hidden_until_submit','reveal_refresh','revoke_cancel_confirm_hides_reveal','guest_registration_preserves_self','invitation_filters_and_share_url','history_repeat_compare_refresh','journal_choice_date_reset','password_rotates_sessions','recovery_confirm_hide','logout_all_sessions','recovery_and_relogin_preserve_history','6_secondary_routes','4_mobile_no_overflow','mobile_computed_text_contrast','fixed_nav_scroll_clearance','responsive_design_320_430_768_1440','design_assets_loaded','result_share_explicit_preview_app_link','share_four_platform_png_downloads','share_real_qr_decode','share_caption_edit','share_native_mock_cancel_success_error','share_mobile_no_overflow','share_mobile_visible_unobscured_download_copy','keyboard_skip_link_functional_hidden_when_unfocused','all_design_states_desktop_mobile','mirror_three_independent_responses','reverse_directed_access','reverse_chooser_sent_recipient_reveal'],page_errors:errors,screenshots:out}));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e.stack);process.exitCode=1});

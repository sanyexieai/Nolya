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
  const context = await browser.newContext({ viewport: { width:1440, height:1000 }, deviceScaleFactor:1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(base);
    await page.getByRole('heading', {level:1}).waitFor();
    await page.screenshot({path:path.join(out,'home-desktop.png'),fullPage:true});
    await page.getByRole('link', {name:/开始我的第一次镜像/}).click();
    // Missing answer cannot advance. Previous-step edits survive back navigation.
    await page.getByRole('radio').first().waitFor();
    assert(await page.getByRole('button', {name:/下一题/}).isDisabled());
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
    await page.locator('.self-result-art').waitFor();
    await page.screenshot({path:path.join(out,'self-result-desktop.png'),fullPage:true});
    await page.reload();
    await page.locator('.self-result-art').waitFor();
    await page.goto(base+'/today');
    await page.getByRole('radio').first().waitFor();
    await page.getByRole('radio').first().click();
    await page.getByRole('button',{name:/留下今天的选择/}).click();
    await page.locator('.saved-choice').waitFor();
    await page.screenshot({path:path.join(out,'daily-desktop.png'),fullPage:true});
    // Invite creation, owner exclusion, independent friend consent and persistence.
    await page.goto(base+'/invite');
    await page.getByRole('button',{name:/生成朋友邀请链接/}).click();
    const friendUrl = await page.getByRole('textbox',{name:'分享链接'}).inputValue();
    assert.equal(new URL(friendUrl).origin, target.origin);
    await page.goto(friendUrl);
    await page.getByText('这是你自己的邀请', {exact:true}).waitFor();
    const peer = await browser.newContext({viewport:{width:390,height:844}});
    const friend = await peer.newPage();
    friend.on('pageerror', e => errors.push(e.message));
    await friend.goto(friendUrl);
    const start = friend.getByRole('button',{name:/说说我眼中的/});
    assert(await start.isDisabled());
    await friend.getByRole('checkbox').check();
    await start.click();
    for(let i=0;i<3;i++) {
      await friend.getByRole('radio').first().click();
      await friend.getByRole('button',{name:i===2?'送出我的视角':/下一题/}).click();
    }
    await friend.getByText('你的 3 个选择已保存',{exact:true}).waitFor();
    await friend.reload();
    await friend.getByText('你的 3 个选择已保存',{exact:true}).waitFor();
    await page.goto(base+'/mirror');
    await page.getByText('1 / 3 个独立视角已送达',{exact:true}).waitFor();
    // Guess answers are not rendered until the other identity submits a guess.
    await page.goto(base+'/guess/new');
    await page.getByRole('radio').first().click();
    await page.getByRole('button',{name:/收好谜底，生成邀请/}).click();
    const guessUrl = await page.getByRole('textbox',{name:'分享链接'}).inputValue();
    await friend.goto(guessUrl);
    await friend.getByRole('radio').first().waitFor();
    assert.equal(await friend.locator('.actual-choice').count(),0);
    assert(await friend.getByRole('button',{name:/我猜好了，揭晓答案/}).isDisabled());
    await friend.getByRole('radio').first().click();
    await friend.getByRole('button',{name:/我猜好了，揭晓答案/}).click();
    await friend.locator('.actual-choice').waitFor();
    await friend.reload();
    await friend.locator('.actual-choice').waitFor();
    await friend.screenshot({path:path.join(out,'reveal-mobile.png'),fullPage:true});
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
    // One-record history, a genuine second assessment, and comparison details.
    await page.goto(base+'/self/history');
    await page.getByRole('heading',{name:'全部 1 次记录',exact:true}).waitFor();
    await page.getByRole('link',{name:'再做一次镜像',exact:true}).click();
    for(let i=0;i<8;i++) {
      await page.getByRole('radio').nth(1).click();
      await page.getByRole('button',{name:i===7?'看看我的第一张镜像':/下一题/}).click();
    }
    await page.waitForURL('**/self/result');
    await page.locator('.self-result-art').waitFor();
    await page.goto(base+'/self/history');
    await page.getByRole('heading',{name:'全部 2 次记录',exact:true}).waitFor();
    await page.getByLabel('选择对比记录').selectOption({index:0});
    assert.equal(await page.locator('.history-dimensions article').count(),4);
    await page.locator('.history-entry summary').first().click();
    assert.equal(await page.locator('.history-entry').first().getAttribute('open'),'');
    await page.reload();
    await page.getByRole('heading',{name:'全部 2 次记录',exact:true}).waitFor();
    // Filter the real daily A answer, then reset without deleting it.
    await page.goto(base+'/journal');
    await page.locator('.journal-entry').waitFor();
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
    await page.goto(base+'/account');
    const username = 'qa_'+Date.now();
    await page.getByLabel('用户名',{exact:true}).fill(username);
    await page.getByLabel('密码',{exact:true}).fill('Synthetic-Only-Password-2026');
    await page.getByRole('button',{name:'创建账户，保存我的选择'}).click();
    await page.waitForURL('**/space');
    await page.goto(base+'/account');
    await page.getByRole('button',{name:'退出登录',exact:true}).waitFor();
    await page.goto(base+'/self/result');
    await page.locator('.self-result-art').waitFor();
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
    await page.getByLabel('用户名',{exact:true}).fill(username);
    await page.getByLabel('恢复码',{exact:true}).fill(recoveryCode);
    await page.getByLabel('新密码',{exact:true}).fill('Synthetic-Recovered-Password-2026');
    await page.getByLabel('再次输入新密码',{exact:true}).fill('Synthetic-Recovered-Password-2026');
    await page.getByRole('button',{name:'重置账户密码',exact:true}).click();
    await page.getByRole('button',{name:'前往登录',exact:true}).waitFor();
    recoveryCode = '';
    await page.getByRole('button',{name:'前往登录',exact:true}).click();
    await login(page,'Synthetic-Recovered-Password-2026');
    await page.goto(base+'/self/history');
    await page.getByRole('heading',{name:'全部 2 次记录',exact:true}).waitFor();
    for(const route of ['/journal','/mirror','/invite','/guess/new','/space','/account']) {
      await page.goto(base+route);
      await page.getByRole('heading',{level:1}).waitFor();
      await page.waitForTimeout(200);
      if(await page.locator('body').innerText().then(t=>t.includes('Unexpected Application Error'))) throw new Error('Route failed '+route);
    }
    await page.setViewportSize({width:390,height:844});
    for(const [route,label] of [['/','home'],['/self/result','self-result'],['/today','daily'],['/space','space']]) {
      await page.goto(base+route);
      await page.getByRole('heading',{level:1}).waitFor();
      await page.waitForTimeout(300);
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
      if(overflow) throw new Error('Horizontal overflow '+route);
      await page.screenshot({path:path.join(out,label+'-mobile.png'),fullPage:true});
    }
    if(errors.length)throw new Error('Browser errors: '+errors.join(';'));
    console.log(JSON.stringify({status:'passed',checks:['self_keyboard_radio','self_required_answer','self_back_preserves_selection','self_interruption_resets','self_8_answers','self_refresh_persistence','daily_vote','friend_consent_owner_exclusion','friend_submission_refresh','mirror_one_response','guess_hidden_until_submit','reveal_refresh','revoke_cancel_confirm_hides_reveal','guest_registration_preserves_self','invitation_filters_and_share_url','history_repeat_compare_refresh','journal_choice_date_reset','password_rotates_sessions','recovery_confirm_hide','logout_all_sessions','recovery_and_relogin_preserve_history','6_secondary_routes','4_mobile_no_overflow'],page_errors:errors,screenshots:out}));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e.stack);process.exitCode=1});

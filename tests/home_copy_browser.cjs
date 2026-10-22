// Controlled copy draws live only in these isolated synthetic browser contexts.
// No application test flags, response mocks, storage seeds or crypto overrides.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const copy = require('../frontend/src/home.zh-CN.json');

async function checkHomeCopyVariants(browser, base, out, settle) {
  const variants = copy.hero.variants;
  assert.equal(variants.length, 5);
  assert.equal(new Set(variants.map(variant => variant.id)).size, 5);
  const samples = [];
  const layoutProblems = [];
  const checkLayout = (passes, message) => { if (!passes) layoutProblems.push(message); };
  for (const [index, variant] of variants.entries()) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await context.addInitScript(value => {
      // Math.random is not used for IDs/security; crypto retains its native API.
      window.__homeCopyDraw = value;
      Math.random = () => window.__homeCopyDraw;
    }, (index + 0.5) / variants.length);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    async function expectVariant(expected) {
      await page.locator(`.home-hero[data-hero-variant="${expected.id}"]`).waitFor();
      assert.equal(await page.locator('.hero-copy h1').textContent(), expected.headline.replaceAll('\n', ''));
      assert.equal(await page.locator('.hero-copy > p').textContent(), expected.subheadline);
      assert.equal(await page.locator('.hero-copy > .badge').textContent(), expected.eyebrow);
      assert.equal(await page.locator('.hero-actions a[href="/self"]').textContent(), copy.hero.primaryCTA);
      assert.equal(await page.locator('.hero-actions a[href="/mirror"]').textContent(), copy.hero.secondaryCTA);
    }
    try {
      await page.goto(base);
      await expectVariant(variant);
      for (const width of [320, 390, 430, 1440]) {
        const size = width === 1440 ? 'desktop' : 'mobile';
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
        const label = `home-copy-${variant.id}-${size}-${width}`;
        await settle(page, undefined, label);
        await expectVariant(variant);
        const geometry = await page.locator('.home-hero').evaluate(hero => {
          const rect = element => { const b = element.getBoundingClientRect(); return { left:b.left, right:b.right, top:b.top, bottom:b.bottom, width:b.width, height:b.height }; };
          const copy = hero.querySelector('.hero-copy');
          const art = hero.querySelector('.home-v2-artwork');
          const text = [...copy.querySelectorAll('.badge, h1, :scope > p, .micro-benefits')].map(element => {
            const bounds = rect(element), glyphs = [], ancestors = new Map();
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              if (!walker.currentNode.textContent.trim()) continue;
              const range = document.createRange(); range.selectNodeContents(walker.currentNode);
              const boxes = [...range.getClientRects()].filter(box => box.width && box.height);
              // CJK font ascenders/descenders may extend outside the CSS line
              // box without being clipped. Only clipping ancestors can cut
              // these visible glyph extents; inspect every text-node ancestor.
              const clips = [];
              for (let parent = walker.currentNode.parentElement; parent; parent = parent.parentElement) {
                const style = getComputedStyle(parent), box = rect(parent);
                const info = { tag:parent.tagName, classes:parent.className, overflowX:style.overflowX, overflowY:style.overflowY,
                  left:box.left+parent.clientLeft, right:box.left+parent.clientLeft+parent.clientWidth,
                  top:box.top+parent.clientTop, bottom:box.top+parent.clientTop+parent.clientHeight };
                ancestors.set(parent, info);
                clips.push(info);
              }
              for (const box of boxes) glyphs.push({ left:box.left, right:box.right, top:box.top, bottom:box.bottom,
                clippedX:clips.some(clip => ['hidden','clip'].includes(clip.overflowX) && (box.left<clip.left-1 || box.right>clip.right+1)),
                clippedY:clips.some(clip => ['hidden','clip'].includes(clip.overflowY) && (box.top<clip.top-1 || box.bottom>clip.bottom+1)) });
            }
            const glyphBounds = { left:Math.min(...glyphs.map(box=>box.left)), right:Math.max(...glyphs.map(box=>box.right)), top:Math.min(...glyphs.map(box=>box.top)), bottom:Math.max(...glyphs.map(box=>box.bottom)) };
            return { tag:element.tagName, bounds, glyphBounds, glyphs, overflowAncestors:[...ancestors.values()], right:glyphBounds.right,
              clippedX:glyphs.some(box=>box.clippedX||box.left<bounds.left-1||box.right>bounds.right+1), clippedY:glyphs.some(box=>box.clippedY) };
          });
          return { copy:rect(copy), art:rect(art), mask:getComputedStyle(art).maskImage, text, headline:rect(copy.querySelector('h1')), body:rect(copy.querySelector(':scope > p')), actions:rect(copy.querySelector('.hero-actions')) };
        });
        fs.writeFileSync(path.join(out, `${label}-geometry.json`), JSON.stringify(geometry, null, 2));
        checkLayout(geometry.text.every(text => text.glyphs.length > 0 && !text.clippedX && !text.clippedY), `${label}: copy must fit horizontally and have no actual ancestor clipping`);
        const [badgeText, headlineText, bodyText, benefitsText] = geometry.text;
        checkLayout(badgeText.glyphBounds.bottom <= headlineText.glyphBounds.top + 1 && headlineText.glyphBounds.bottom <= bodyText.glyphBounds.top + 1 && bodyText.glyphBounds.bottom <= geometry.actions.top + 1 && geometry.actions.bottom <= benefitsText.glyphBounds.top + 1, `${label}: actual text extents and actions must not overlap`);
        checkLayout(geometry.headline.bottom <= geometry.body.top + 1 && geometry.body.bottom <= geometry.actions.top + 1, `${label}: heading, description and actions must not overlap`);
        if (width < 801) {
          checkLayout(geometry.art.bottom <= Math.min(geometry.copy.top, ...geometry.text.map(text => text.glyphBounds.top)) + 1, `${label}: mobile artwork must remain above live copy`);
        } else {
          // The original artwork intentionally fades in across its left 13%.
          checkLayout(geometry.mask.includes('13%'), `${label}: retain the original artwork's text-safe fade`);
          checkLayout(geometry.text.every(text => text.right <= geometry.art.left + geometry.art.width * 0.13 + 1), `${label}: live text must not enter the opaque artwork`);
        }
        const actions = page.locator('.hero-actions');
        await actions.evaluate(element => element.scrollIntoView({ block:'center', behavior:'instant' }));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const controls = await actions.locator('a.button').evaluateAll(elements => elements.map(element => {
          const box = element.getBoundingClientRect(), nav = document.querySelector('.mobile-nav'), style = getComputedStyle(nav);
          const bottom = style.display !== 'none' && style.position === 'fixed' ? nav.getBoundingClientRect().top : innerHeight;
          return { height:box.height, visible:box.top>=0&&box.bottom<=bottom&&box.left>=0&&box.right<=innerWidth, hit:element.contains(document.elementFromPoint(box.left+box.width/2,box.top+box.height/2)) };
        }));
        assert.equal(controls.length, 2);
        checkLayout(controls.every(control => control.height >= 44 && control.visible && control.hit), `${label}: both real CTA links must be reachable and unobscured`);
        await settle(page, undefined, label);
        // Hero-only PNGs keep the 20-image matrix within split artifact budgets.
        const file = `${label}.png`;
        await page.locator('.home-hero').screenshot({ path:path.join(out,file), animations:'disabled' });
        samples.push({ variant:variant.id, width, file, geometry, controls });
      }
      // A real identity change triggers SessionProvider and Home to rerender.
      // Vary the next draw first: stable copy must not depend on constant RNG.
      await page.evaluate(value => { window.__homeCopyDraw = value; }, ((index + 1) % variants.length + 0.5) / variants.length);
      const guestCreated = await page.evaluate(async () => (await fetch('/api/v1/session/guest', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}', credentials:'include' })).ok);
      assert(guestCreated, 'Create only a synthetic guest through the real local API');
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/session' && response.request().method() === 'GET');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      assert((await refreshed).ok(), 'Focus must refresh the actual session');
      await page.locator('.daily-teaser strong').filter({ hasText:'查看今日问题' }).waitFor();
      await expectVariant(variant);
      // SPA navigation unmounts Home; a fresh draw chooses the controlled next
      // variant. A repeated draw is equally valid and must not be forced away.
      for (const next of [variants[(index + 1) % variants.length], variants[(index + 1) % variants.length]]) {
        await page.locator('.site-footer a[href="/help"]').first().click();
        await page.waitForURL('**/help');
        await page.locator('header a.wordmark[href="/"]').click();
        await expectVariant(next);
      }
      assert.deepEqual(errors, [], 'Copy browser matrix must not introduce page errors');
    } catch (error) {
      const width = page.viewportSize().width;
      await page.screenshot({ path:path.join(out, `home-copy-${variant.id}-${width===1440?'desktop':'mobile'}-failure.png`), fullPage:false, animations:'disabled' });
      throw error;
    } finally {
      fs.writeFileSync(path.join(out, 'home-copy-variants.json'), JSON.stringify({ samples, layoutProblems }, null, 2));
      await context.close();
    }
  }
  assert.equal(samples.length, 20);
  assert.deepEqual(layoutProblems, [], 'All 20 home-copy layout samples must pass; see home-copy-variants.json and per-sample geometry/screenshots');
}
module.exports = { checkHomeCopyVariants };

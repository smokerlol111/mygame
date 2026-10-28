// Compare the actual PLAYER's layout before/after the same theme event that HOST
// broadcasts. The standard theme is the reference; no copied sizing constants.
const assert = require('node:assert/strict');
const path = require('node:path');

const snapshot = `(() => {
  const metrics = ['display','position','boxSizing','width','height','minWidth','minHeight','maxWidth','maxHeight',
    'paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginRight','marginBottom','marginLeft',
    'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderRadius',
    'fontFamily','fontSize','fontWeight','fontVariantNumeric','lineHeight','letterSpacing','textAlign','overflowWrap',
    'gap','rowGap','columnGap','alignItems','justifyContent','flexWrap','flexDirection','objectFit','outlineWidth','outlineOffset'];
  return [...document.querySelectorAll('body, .wrap, .wrap *, #netBadge')].filter(el => el.tagName !== 'SCRIPT').map(el => {
    const style = getComputedStyle(el), rect = el.getBoundingClientRect();
    return {tag:el.tagName,id:el.id,className:el.className,
      rect:[rect.x,rect.y,rect.width,rect.height].map(n=>Math.round(n*100)/100),
      styles:Object.fromEntries(metrics.map(key=>[key,style[key]]))};
  });
})()`;

async function checkPlayerThemeLayout(browser, url, screenshotDirectory) {
  const profiles = [[320,740,true], [390,844,true], [768,1024,true], [1280,900,false], [1920,1080,false]];
  const views = ['login','lobby','board','photo','buzz','long','paused','video','bet','final-input'];
  let comparisons = 0;
  for (const [width,height,touch] of profiles) {
    for (const view of views) {
      const fixture = ['bet','final-input'].includes(view) ? 'text' : view;
      const page = await browser.page(`${url}/play?preview=halloween&view=${fixture}`, width, height, {touch});
      try {
        await page.evaluate('QuizTheme.bind({on: (_event, handler) => window.receiveThemeForLayoutTest = handler}, () => state || {code:"DEMO",uiTheme:document.body.dataset.uiTheme || null,phase:"login"})');
        if (view === 'bet') await page.evaluate('state.phase="final_bets";render();document.getElementById("bet").focus()');
        if (view === 'final-input') await page.evaluate('state.phase="final_question";state.finalSeconds=30;render();document.getElementById("finalAnswer").focus()');
        if (view === 'video') await page.evaluate(`(async()=>{const video=document.getElementById('playerVideo');if(video.readyState>=1)return;await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Video metadata timeout')),5000);video.addEventListener('loadedmetadata',()=>{clearTimeout(timeout);resolve();},{once:true});});})()`);
        await page.evaluate('receiveThemeForLayoutTest({code:state?.code || QuizPreview.state.code,uiTheme:null})');
        const standard = await page.evaluate(snapshot);
        if (screenshotDirectory && width === 1920 && ['login','lobby','board'].includes(view)) await page.screenshot(path.join(screenshotDirectory, `player-${view}-desktop-standard.png`));
        await page.evaluate('receiveThemeForLayoutTest({code:state?.code || QuizPreview.state.code,uiTheme:"halloween"})');
        const themed = await page.evaluate(snapshot);
        assert.deepEqual(themed, standard, `${width}x${height}/${view}: every PLAYER box, spacing and font must match standard`);
        assert.equal(await page.evaluate('!!document.getElementById("toggleTheme")'), false);
        assert.deepEqual(page.errors, []);
        if (screenshotDirectory && width === 1920 && ['login','lobby','board'].includes(view)) await page.screenshot(path.join(screenshotDirectory, `player-${view}-desktop-halloween.png`));
        comparisons++;
      } finally { await page.close(); }
    }
  }
  console.log(`PASS: ${comparisons} PLAYER geometry comparisons against standard at 320/390/768/1280/1920 px, touch and desktop; login/lobby/board/photo/BUZZ/long text/pause/video/bet/final input`);
}
module.exports = { checkPlayerThemeLayout };

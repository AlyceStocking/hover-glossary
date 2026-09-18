// Real browser / installed Harness test. No model requests or session writes.
// DSH_TEST_URL or DSH_TEST_LOG: authenticated URL or startup log (never printed).
// PLAYWRIGHT_MODULE: optional absolute path to a locally installed playwright entry.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const url = process.env.DSH_TEST_URL || readFileSync(process.env.DSH_TEST_LOG, 'utf8').match(/http:\/\/[^\s\x1b]+/)[0];
const browser = await chromium.launch({channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless:true});
const page = await browser.newPage({viewport:{width:1280,height:900}});
page.setDefaultTimeout(12000);
const errors=[];
page.on('pageerror', e=>errors.push(e.message));
const results=[];
async function check(name, run) { await run(); results.push(name); console.log('PASS '+name); }
async function hoverWord(selector, word) {
  const point=await page.locator(selector).last().evaluate((root, word)=>{
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    for(let node; (node=walker.nextNode());) {
      const i=node.data.indexOf(word);
      if(i<0 || node.parentElement.closest('a,button,textarea,input,summary')) continue;
      node.parentElement.scrollIntoView({block:'center'});
      const range=document.createRange(); range.setStart(node,i); range.setEnd(node,i+1);
      const r=range.getBoundingClientRect();
      if(r.width && r.height) return {x:r.left+r.width/2,y:r.top+r.height/2};
    }
    throw Error('Missing visible word: '+word);
  },word);
  await page.waitForTimeout(70);
  await page.mouse.move(point.x,point.y);
  await page.waitForTimeout(100);
}
try {
  await page.goto(url);
  await page.waitForFunction(()=>!!globalThis.__hoverGlossaryDiag__);
  await check('Harness boots with the installed plugin',async()=>{
    assert.equal(await page.getByText('Failed to load plugins',{exact:true}).count(),0);
    assert.equal(await page.locator('.hg-diag').count(),0);
    assert.equal(await page.locator('style[data-hover-glossary]').count(),1);
  });
  await page.getByText(process.env.DSH_TEST_SESSION || 'DeepSeek 词联想插件开发',{exact:true}).click();
  await page.locator('[data-chat-flow-kind="assistant-step"]').last().waitFor();
  await check('WHO in the existing assistant message shows both meanings',async()=>{
    await hoverWord('[data-chat-flow-kind="assistant-step"]','WHO');
    const tip=await page.locator('.hg-tip').innerText();
    assert.match(tip,/世卫组织/); assert.match(tip,/谁/);
    const b=await page.locator('.hg-tip').boundingBox();
    assert.ok(b.x>=0 && b.y>=0 && b.x+b.width<=1280 && b.y+b.height<=900);
    if(process.env.DSH_SCREENSHOT) await page.screenshot({path:process.env.DSH_SCREENSHOT});
  });
  // Transient DOM fixtures exercise Chromium caret geometry with the actual plugin.
  // They are never sent to the model or persisted in the conversation.
  await page.evaluate(()=>{
    const f=document.createElement('div');f.id='hg-browser-fixture';
    f.style.cssText='position:fixed;left:330px;top:100px;width:650px;padding:12px;z-index:2147482000;background:white;color:black;font:18px/2 sans-serif';
    for(const kind of ['user','assistant-step','sidebar']) {
      const p=document.createElement('p');p.id='hg-test-'+kind;
      if(kind!=='sidebar') p.dataset.chatFlowKind=kind;
      p.textContent='WHO API DSH Cordis LLM 即世界卫生组织发布报告 United Nations WHOLE RAPID';
      f.append(p);
    }
    document.body.append(f);
  });
  for(const kind of ['user','assistant-step']) {
    for(const [word,meaning] of [['WHO','世卫组织'],['API','应用程序编程接口'],['DSH','数字签名硬件'],['Cordis','插件运行时'],['LLM','大语言模型'],['世界卫生组织','简称世卫组织'],['United','联合国']]) {
      await check(kind+' / '+word,async()=>{
        await hoverWord('#hg-test-'+kind,word);
        assert.ok((await page.locator('.hg-tip').innerText()).includes(meaning));
      });
    }
  }
  for(const [selector,word] of [['#hg-test-sidebar','WHO'],['#hg-test-user','WHOLE'],['#hg-test-user','RAPID']]) {
    await check('No false positive: '+selector+' / '+word,async()=>{
      await hoverWord(selector,word); assert.equal(await page.locator('.hg-tip').count(),0);
    });
  }
  await check('Scroll hides the tooltip',async()=>{
    await hoverWord('#hg-test-user','WHO');
    await page.evaluate(()=>document.dispatchEvent(new Event('scroll')));
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.hg-tip').count(),0);
  });
  await page.evaluate(()=>document.getElementById('hg-browser-fixture').remove());
  await check('Fresh page reload activates exactly one overlay',async()=>{
    await page.reload(); await page.waitForFunction(()=>!!globalThis.__hoverGlossaryDiag__);
    assert.equal(await page.locator('style[data-hover-glossary]').count(),1);
    assert.equal(await page.getByText('Failed to load plugins',{exact:true}).count(),0);
  });
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:results.length,pageErrors:errors}));
} finally { await browser.close(); }

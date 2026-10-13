import os,json
from pathlib import Path
from playwright.sync_api import sync_playwright
out=Path('artifacts/design');out.mkdir(exist_ok=True,parents=True)
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path=os.getenv('PLAYWRIGHT_CHROMIUM_EXECUTABLE'))
 for name,url in [('dpoker','http://localhost:5173/DPoker/'),('qpds','http://localhost:8080/')]:
  for size in [(1440,1000),(390,844)]:
   ctx=b.new_context(viewport={'width':size[0],'height':size[1]});page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto(url);page.wait_for_load_state('networkidle');page.evaluate('document.fonts.ready');page.wait_for_timeout(1200)
   print(json.dumps({'site':name,'width':size[0],'errors':errors,'overflow':page.evaluate('document.documentElement.scrollWidth>innerWidth'),'fonts':page.evaluate("document.fonts.check('700 20px Barlow')"),'headings':page.locator('h1').all_text_contents()},ensure_ascii=False),flush=True)
   page.screenshot(path=str(out/f'{name}-{size[0]}.png'),full_page=size[0]<500)
   if name=='qpds' and size[0]>500:
    page.locator('.practice > summary').click();page.locator('#practiceExample').select_option('1');page.locator('#recommendButton').click();page.locator('#candidateTable').wait_for(state='visible',timeout=60000);page.wait_for_timeout(700)
    page.locator('#studioHeading').evaluate("el=>el.scrollIntoView({block:'start',behavior:'instant'})");page.screenshot(path=str(out/'qpds-workspace.png'))
   ctx.close()
 b.close()

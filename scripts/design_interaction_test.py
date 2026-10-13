"""Local visual interaction checks: layout, motion preferences and keyboard dialogs."""
import os
from playwright.sync_api import sync_playwright,expect
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.getenv('PLAYWRIGHT_CHROMIUM_EXECUTABLE'))
    for url,name in [('http://localhost:5173/DPoker/','dpoker'),('http://localhost:8080/','qpds')]:
        for width in (320,768):
            ctx=browser.new_context(viewport={'width':width,'height':900},reduced_motion='reduce')
            page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(url);page.wait_for_load_state('networkidle');page.evaluate('document.fonts.ready')
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(name,width,'overflow')
            expect(page.get_by_role('button',name='播放装饰动画')).to_be_visible()
            assert page.locator('h1').is_visible()
            if name=='qpds':
                expect(page.locator('#apiConfigBtn')).to_be_visible()
                first=page.locator('canvas').evaluate('(c)=>c.toDataURL()');page.wait_for_timeout(150)
                assert first==page.locator('canvas').evaluate('(c)=>c.toDataURL()'),'Reduced motion still animates canvas'
                page.locator('#gameManualBtn').click();expect(page.locator('#gameManualModal')).to_be_visible()
                page.keyboard.press('Escape');expect(page.locator('#gameManualModal')).to_be_hidden()
                page.locator('#heroReplay').click();expect(page.locator('.practice')).to_have_attribute('open','')
            assert not errors,errors
            ctx.close()
    ctx=browser.new_context(viewport={'width':1440,'height':1000});page=ctx.new_page()
    page.goto('http://localhost:8080/');page.wait_for_load_state('networkidle')
    page.get_by_role('button',name='暂停装饰动画').click()
    first=page.locator('canvas').evaluate('(c)=>c.toDataURL()');page.wait_for_timeout(150)
    assert first==page.locator('canvas').evaluate('(c)=>c.toDataURL()'),'Manual pause still animates canvas'
    page.get_by_role('button',name='播放装饰动画').click();page.wait_for_timeout(150)
    assert first!=page.locator('canvas').evaluate('(c)=>c.toDataURL()'),'Motion did not resume'
    print('PASS: 320/768px layouts, reduced motion, pause/resume, handbook keyboard close and direct replay entry')
    browser.close()

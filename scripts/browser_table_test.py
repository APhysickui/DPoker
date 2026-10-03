"""Nine independent browser identities at one table; capture 390px full-table layout."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
expect.set_options(timeout=20000)

URL=os.getenv('WEB_URL','http://localhost:5173/DPoker/')
OUT=Path('artifacts');OUT.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.getenv('PLAYWRIGHT_CHROMIUM_EXECUTABLE'), proxy={'server':os.environ['PLAYWRIGHT_PROXY_SERVER']} if os.getenv('PLAYWRIGHT_PROXY_SERVER') else None)
    pages=[];errors=[]
    for i in range(9):
        context=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
        page=context.new_page();pages.append(page)
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(URL if i==0 else pages[0].url)
        page.wait_for_load_state('networkidle')
        page.get_by_label('你的昵称').fill('朋友'+str(i+1))
        page.get_by_role('button',name='创建私人牌桌' if i==0 else '加入牌桌').click()
        expect(page.get_by_text('已连接',exact=True)).to_be_visible()
    expect(pages[0].get_by_text('9 / 9 已入座',exact=False)).to_be_visible()
    for page in pages:
        page.get_by_role('button',name='准备下一手',exact=True).click()
        expect(page.get_by_role('button',name='取消准备',exact=True)).to_be_visible()
    pages[0].get_by_role('button',name='开始牌局 →').click()
    for page in pages:
        expect(page.locator('.phase')).to_have_text('翻牌前')
        expect(page.locator('.seat .avatar')).to_have_count(9)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
        expect(page.locator('.your-hand .card')).to_have_count(2)
    pages[0].screenshot(path=str(OUT/'nine-player-mobile.png'),full_page=True)
    assert not errors,errors
    print('PASS: 9 independent browser seats, readiness, deal, private hand rendering and mobile full-table layout')
    browser.close()

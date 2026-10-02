"""Browser acceptance: independent identities, mobile screenshots, refresh and full hand.
Start Vite :5173 and Wrangler :8787 first. See README for dependencies.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

OUT = Path('artifacts')
OUT.mkdir(exist_ok=True)
URL = os.getenv('WEB_URL', 'http://localhost:5173/DPoker/')
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.getenv('PLAYWRIGHT_CHROMIUM_EXECUTABLE'))
    desktop = browser.new_context(viewport={'width': 1440, 'height': 1000})
    mobile = browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, device_scale_factor=2, has_touch=True)
    a, b = desktop.new_page(), mobile.new_page()
    errors = []
    for page in [a, b]:
        page.on('pageerror', lambda e: errors.append(str(e)))
    a.goto(URL)
    a.wait_for_load_state('networkidle')
    a.screenshot(path=str(OUT / 'landing-desktop.png'), full_page=True)
    b.goto(URL)
    b.wait_for_load_state('networkidle')
    b.screenshot(path=str(OUT / 'landing-mobile.png'), full_page=True)
    assert b.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Landing horizontal overflow'
    a.get_by_label('你的昵称').fill('阿青')
    a.get_by_role('button', name='创建私人牌桌').click()
    expect(a.get_by_text('已连接', exact=True)).to_be_visible()
    invitation = a.url
    b.goto(invitation)
    b.get_by_label('你的昵称').fill('小鹿')
    b.get_by_role('button', name='加入牌桌').click()
    expect(b.get_by_text('已连接', exact=True)).to_be_visible()
    a.get_by_role('button', name='准备下一手', exact=True).click()
    expect(a.get_by_role('button', name='取消准备', exact=True)).to_be_visible()
    b.get_by_role('button', name='准备下一手', exact=True).click()
    expect(a.get_by_role('button', name='开始牌局 →')).to_be_enabled()
    a.get_by_role('button', name='开始牌局 →').click()
    expect(a.locator('.phase')).to_have_text('翻牌前')
    expect(b.locator('.phase')).to_have_text('翻牌前')
    b.screenshot(path=str(OUT / 'table-mobile.png'), full_page=True)
    a.screenshot(path=str(OUT / 'table-desktop.png'), full_page=True)
    # Refresh keeps the seat and own cards, and direct hash URL resolves.
    b.reload()
    expect(b.get_by_text('已连接', exact=True)).to_be_visible()
    expect(b.locator('.your-hand .card')).to_have_count(2)
    for _ in range(20):
        if a.locator('.phase').inner_text() == '本手结算':
            break
        acting = a if a.locator('.turn-heading').count() else b
        expect(acting.locator('.turn-heading')).to_be_visible()
        action = acting.get_by_role('button', name='过牌', exact=True)
        if not action.count():
            action = acting.get_by_role('button', name='跟注', exact=False)
        before = acting.locator('.phase').inner_text()
        action.click()
        # Wait for server ack to avoid acting on the old state.
        acting.wait_for_function("previous => !document.querySelector('.turn-heading') || document.querySelector('.phase').textContent !== previous", arg=before)
    expect(a.locator('.phase')).to_have_text('本手结算')
    expect(b.locator('.phase')).to_have_text('本手结算')
    b.screenshot(path=str(OUT / 'showdown-mobile.png'), full_page=True)
    assert b.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile horizontal overflow'
    assert not errors, errors
    print(json.dumps({'status':'passed','checks':['create','invite','independent seats','ready/start','full hand','mobile layout','hash refresh','no JS exceptions'],'screenshots':str(OUT)}, ensure_ascii=False))
    browser.close()

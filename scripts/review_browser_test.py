"""Local end-to-end review: DPoker private export/seat restore -> QPDS replay.
Requires DPoker :5173/:8788 and QPDS :8080. Never targets production.
"""
import json
import os
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

OUT=Path('artifacts/review')
OUT.mkdir(parents=True,exist_ok=True)
expect.set_options(timeout=20000)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=os.getenv('PLAYWRIGHT_CHROMIUM_EXECUTABLE'))
    host=browser.new_context(viewport={'width':1440,'height':1000})
    guest=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
    a,b=host.new_page(),guest.new_page()
    errors=[]
    for page in [a,b]:page.on('pageerror',lambda e:errors.append(str(e)))
    a.goto('http://localhost:5173/DPoker/')
    a.get_by_label('你的昵称').fill('复盘甲')
    a.get_by_role('button',name='创建私人牌桌').click()
    expect(a.get_by_text('已连接',exact=True)).to_be_visible()
    invitation=a.url
    with a.expect_download() as download:
        a.get_by_role('button',name='备份我的座位',exact=True).click()
    seat=OUT/'seat.json';download.value.save_as(str(seat))
    b.goto(invitation);b.get_by_label('你的昵称').fill('复盘乙');b.get_by_role('button',name='加入牌桌').click()
    expect(b.get_by_text('已连接',exact=True)).to_be_visible()
    a.get_by_role('button',name='准备下一手',exact=True).click()
    expect(a.get_by_role('button',name='取消准备',exact=True)).to_be_visible()
    b.get_by_role('button',name='准备下一手',exact=True).click()
    expect(a.get_by_role('button',name='开始牌局 →')).to_be_enabled()
    a.get_by_role('button',name='本手结束后暂停',exact=True).click()
    expect(a.get_by_role('button',name='继续牌局',exact=True)).to_be_visible()
    a.get_by_role('button',name='开始牌局 →').click()
    expect(a.locator('.phase')).to_have_text('翻牌前')
    a.get_by_role('button',name='底池',exact=True).click()
    expect(a.locator('#raise')).to_have_value('30')
    for _ in range(30):
        if a.locator('.phase').inner_text()=='本手结算':break
        acting=a if a.locator('.turn-heading').count() else b
        expect(acting.locator('.turn-heading')).to_be_visible()
        action=acting.get_by_role('button',name='过牌',exact=True)
        if not action.count():action=acting.get_by_role('button',name='跟注',exact=False)
        old=acting.locator('.phase').inner_text();action.click()
        acting.wait_for_function("previous=>!document.querySelector('.turn-heading')||document.querySelector('.phase').textContent!==previous",arg=old)
    expect(a.locator('.phase')).to_have_text('本手结算')
    expect(a.locator('.pause-notice')).to_contain_text('已暂停')
    b.screenshot(path=str(OUT/'dpoker-mobile.png'),full_page=True)
    assert b.evaluate('document.documentElement.scrollWidth<=innerWidth'),'DPoker horizontal overflow'
    a.get_by_role('button',name='牌局回看',exact=True).click()
    expect(a.locator('.history-panel')).to_be_visible()
    with a.expect_download() as download:a.get_by_role('button',name='导出这手复盘',exact=True).click()
    hand=OUT/'hand.json';download.value.save_as(str(hand))
    record=json.loads(hand.read_text())
    assert len(record['board'])==5 and record['decisions'][0]['situation']['board']==[]
    assert all(not d['situation']['hero_cards'] for d in record['decisions'] if d['actor']!=record['viewer'])
    a.screenshot(path=str(OUT/'dpoker-history.png'),full_page=True)
    recovered=browser.new_context(viewport={'width':390,'height':844});r=recovered.new_page();r.on('pageerror',lambda e:errors.append(str(e)))
    r.goto('http://localhost:5173/DPoker/')
    r.locator('.seat-restore input').set_input_files(str(seat))
    expect(r.get_by_text('已连接',exact=True)).to_be_visible()
    expect(r.locator('.phase')).to_have_text('本手结算')
    expect(r.locator('.self .name')).to_contain_text('复盘甲')
    # A single delayed auth attempt must not destroy the saved identity.
    r.add_init_script("""const Native=window.WebSocket;let delayed=false;window.WebSocket=class extends Native{send(data){if(!delayed&&typeof data==='string'&&data.includes('\\"type\\":\\"auth\\"')){delayed=true;setTimeout(()=>{if(this.readyState===1)super.send(data)},11000);return;}super.send(data);}};""")
    reconnect_started=time.monotonic()
    r.reload();expect(r.get_by_text('已连接',exact=True)).to_be_visible(timeout=30000)
    assert time.monotonic()-reconnect_started>=9,'The injected authentication delay was not exercised'
    expect(r.locator('.self .name')).to_contain_text('复盘甲')
    q=browser.new_context(viewport={'width':1440,'height':1000}).new_page();q.on('pageerror',lambda e:errors.append(str(e)))
    q.goto('http://localhost:8080/');q.wait_for_load_state('networkidle')
    q.locator('.practice > summary').click();q.locator('#historyFile').set_input_files(str(hand))
    expect(q.locator('#replayStep option')).to_have_count(4)
    expect(q.locator('#boardSlots [data-filled=true]')).to_have_count(0)
    q.locator('#replayStep').select_option('1')
    expect(q.locator('#boardSlots [data-filled=true]')).to_have_count(3)
    q.locator('#practiceExample').select_option('2')
    q.locator('#recommendButton').click()
    expect(q.locator('#actionValue')).to_have_text('弃牌',timeout=60000)
    expect(q.locator('#candidateTable')).to_be_visible()
    q.locator('#situationName').fill('四条反例')
    q.locator('#saveSituation').click()
    q.reload();q.locator('.practice > summary').click()
    expect(q.locator('#savedSituation option')).to_have_count(1)
    q.locator('#loadSituation').click()
    expect(q.locator('#heroSlots [data-filled=true]')).to_have_count(2)
    q.locator('.range-editor > summary').click()
    expect(q.locator('.range-grid button')).to_have_count(169)
    q.locator('#rangeInput').fill('QQ+,AK')
    expect(q.locator('.range-grid button[data-hand=AA]')).to_have_attribute('aria-pressed','true')
    q.locator('.range-grid button[data-hand=AA]').click()
    assert 'KK' in q.locator('#rangeInput').input_value() and 'AKs' in q.locator('#rangeInput').input_value()
    q.set_viewport_size({'width':390,'height':844})
    assert q.evaluate('document.documentElement.scrollWidth<=innerWidth'),'QPDS horizontal overflow'
    q.locator('#workbench').screenshot(path=str(OUT/'qpds-workbench-mobile.png'))
    q.locator('#langToggle').click()
    expect(q.locator('.practice > summary')).to_contain_text('Review & practice')
    q.locator('#langToggle').click()
    # Saving a replay must preserve the side-pot restriction.
    blocked_record=json.loads(hand.read_text())
    for decision in blocked_record['decisions']:
        if decision['actor']==blocked_record['viewer']:decision['situation']['side_pot']=True
    q.locator('#historyFile').set_input_files({'name':'side-pot.json','mimeType':'application/json','buffer':json.dumps(blocked_record).encode()})
    expect(q.locator('#replayNote')).to_contain_text('边池')
    q.locator('#situationName').fill('边池局面');q.locator('#saveSituation').click()
    q.reload();q.locator('.practice > summary').click();q.locator('#savedSituation').select_option('1');q.locator('#loadSituation').click()
    q.locator('#recommendButton').click();expect(q.locator('#errorBox')).to_contain_text('边池')
    assert not errors,errors
    print(json.dumps({'status':'passed','checks':['pot raise','pause','private history','export','seat restore','auth timeout recovery','QPDS replay','no future board','regression recommendation','saved situation','range grid','mobile layout','no JS exceptions']},ensure_ascii=False))
    browser.close()

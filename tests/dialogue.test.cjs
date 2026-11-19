'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const storageKey = 'polar_station_v1';

function game(saved) {
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  console.on('error', error => errors.push(String(error)));
  const dom = new JSDOM(html, {
    url: 'http://station.test/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: console,
    beforeParse(window) {
      window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.confirm = () => true;
      if (saved) window.localStorage.setItem(storageKey, JSON.stringify(saved));
    },
  });
  assert.deepEqual(errors, [], 'игра должна загрузиться без ошибок скрипта');
  return { window: dom.window, document: dom.window.document, errors, close: () => dom.window.close() };
}

function click(document, selector) {
  const element = document.querySelector(selector);
  assert.ok(element, `Не найдена кнопка ${selector}`);
  element.click();
}

function key(window, element, name, extra = {}) {
  const event = new window.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra });
  element.dispatchEvent(event);
  return event;
}

function untilChoice(document) {
  for (let i = 0; i < 20 && !document.querySelector('[data-story-choice]'); i++) {
    click(document, '#storyNext');
  }
  assert.equal(document.querySelectorAll('[data-story-choice]').length, 3);
}

function finishStory(document) {
  for (let i = 0; i < 20 && document.querySelector('.story-overlay'); i++) {
    assert.ok(!document.querySelector('[data-story-choice]'), 'сначала нужно выбрать ответ');
    click(document, '#storyNext');
  }
  assert.equal(document.querySelector('.story-overlay'), null);
}

function readyAtStation(document) {
  click(document, '#mPlay');
  click(document, '#storySkip'); // Предыстория
  click(document, '#beginAdventure');
  click(document, '#storySkip'); // Диалог первого этапа
}

function state(window, expression = 'state') {
  return JSON.parse(window.eval(`JSON.stringify(${expression})`));
}

function scoreState(window) {
  return state(window, '({stagePoints:state.stagePoints, theoryItems:state.theoryItems, checkAttempts:state.checkAttempts, firstTryEligible:state.firstTryEligible, done:state.done, inventory:state.inventory, events:state.events})');
}

function optionText(element) {
  return element.querySelector('span:last-child').textContent;
}

test('в новом прохождении выбор ведёт к ответу персонажа и затем к заданию', t => {
  const g = game();
  t.after(g.close);
  const { window: w, document: d } = g;
  const before = scoreState(w);
  assert.match(d.querySelector('#dialogue .next').textContent, /выбрать ответ/);

  click(d, '#mPlay');
  untilChoice(d);
  const question = d.querySelector('#storyText').textContent;
  assert.match(question, /сияни/);
  assert.equal(d.querySelector('#storyNext'), null, 'нельзя перейти дальше вместо выбора');
  w.storyNext();
  assert.equal(d.querySelector('#storyText').textContent, question, 'программный переход тоже не обходит выбор');
  assert.ok(d.querySelector('#storySkip'), 'разговор можно пропустить');

  const answer = optionText(d.querySelector('[data-story-choice="1"]'));
  click(d, '[data-story-choice="1"]');
  assert.ok(d.querySelector('#storyAnswer').textContent.includes(answer));
  assert.match(d.querySelector('#storyText').textContent, /сравним показания/);
  assert.equal(d.querySelector('#storySpeaker').textContent, 'Мира');
  assert.equal(state(w, 'state.dialogueChoices.prologue'), 'cable');
  click(d, '#storyNext');
  assert.equal(d.querySelector('#storySpeaker').textContent, 'Болок');
  finishStory(d);
  assert.ok(d.querySelector('#beginAdventure'), 'после предыстории открывается вступление');
  click(d, '#beginAdventure');
  assert.equal(d.querySelector('#storySpeaker').textContent, 'Мира', 'первый этап тоже открывает разговор');
  untilChoice(d);
  click(d, '[data-story-choice="2"]');
  assert.match(d.querySelector('#storyText').textContent, /внимательно/);
  finishStory(d);
  assert.equal(state(w, 'state.storySeen[0]'), true);
  assert.equal(state(w, 'state.dialogueChoices.stage_0'), 'ready');
  assert.deepEqual(scoreState(w), before, 'диалоги не меняют баллы, попытки и журнал');
  assert.deepEqual(g.errors, []);
});

test('все варианты предыстории дают разные реакции и её можно переиграть', t => {
  const g = game();
  t.after(g.close);
  const { window: w, document: d } = g;
  readyAtStation(d);
  const before = scoreState(w), replies = new Set(), ids = [];
  let previous = '';
  for (let i = 0; i < 3; i++) {
    click(d, '#prologueFoot');
    untilChoice(d);
    if (previous) assert.ok(d.querySelector('#storyChoiceHelp').textContent.includes(previous));
    const answer = optionText(d.querySelector(`[data-story-choice="${i}"]`));
    click(d, `[data-story-choice="${i}"]`);
    assert.ok(d.querySelector('#storyAnswer').textContent.includes(answer));
    replies.add(d.querySelector('#storyText').textContent);
    ids.push(state(w, 'state.dialogueChoices.prologue'));
    click(d, '#storyNext');
    assert.equal(d.querySelector('#storySpeaker').textContent, 'Болок');
    click(d, '#storySkip');
    previous = answer;
  }
  assert.equal(replies.size, 3);
  assert.deepEqual(ids, ['storm', 'cable', 'unsure']);
  assert.deepEqual(scoreState(w), before);
  assert.deepEqual(g.errors, []);
});

test('у каждого из семи персонажных диалогов все три ветки работают и возвращаются к истории', t => {
  const g = game();
  t.after(g.close);
  const { window: w, document: d } = g;
  readyAtStation(d);
  const before = scoreState(w);
  const speakers = ['Мира', 'Болок', 'Ника', 'Болок', 'Ника', 'Ника', 'Болок'];

  for (let stage = 0; stage < speakers.length; stage++) {
    w.eval(`state.task=${stage}; state.dialogueIdx=0; render()`);
    const replies = new Set(), choiceIds = new Set();
    for (let option = 0; option < 3; option++) {
      click(d, '#dialogue');
      assert.equal(d.querySelector('#storySpeaker').textContent, speakers[stage]);
      untilChoice(d);
      assert.match(d.querySelector('#storyChoiceHelp').textContent, /не влияет на баллы/);
      const selected = optionText(d.querySelector(`[data-story-choice="${option}"]`));
      click(d, `[data-story-choice="${option}"]`);
      assert.ok(d.querySelector('#storyAnswer').textContent.includes(selected));
      assert.equal(d.querySelector('#storySpeaker').textContent, speakers[stage]);
      replies.add(d.querySelector('#storyText').textContent);
      choiceIds.add(state(w, `state.dialogueChoices.stage_${stage}`));
      click(d, '#storyNext');
      assert.ok(d.querySelector('#storyText').textContent, 'после ответа продолжаются исходные реплики');
      if (option < 2) click(d, '#storySkip');
      else finishStory(d);
    }
    assert.equal(replies.size, 3, `разные реакции на этапе ${stage + 1}`);
    assert.equal(choiceIds.size, 3, `разные ID ответов на этапе ${stage + 1}`);
    assert.equal(state(w, `state.storySeen[${stage}]`), true);
  }
  assert.deepEqual(scoreState(w), before);
  assert.deepEqual(g.errors, []);
});

test('ответ переживает перезагрузку, старое сохранение и новое прохождение', t => {
  const first = game();
  t.after(first.close);
  readyAtStation(first.document);
  first.window.eval("state.task=1;state.done=[0];state.stagePoints[0]=1;state.checkAttempts[0]=1;state.inventory=['compass'];render()");
  click(first.document, '#dialogue');
  untilChoice(first.document);
  const selected = optionText(first.document.querySelector('[data-story-choice="1"]'));
  click(first.document, '[data-story-choice="1"]');
  click(first.document, '#storySkip');
  const saved = JSON.parse(first.window.localStorage.getItem(storageKey));
  assert.equal(saved.dialogueChoices.stage_1, 'settings');

  const reloaded = game(saved);
  t.after(reloaded.close);
  click(reloaded.document, '#mPlay');
  assert.equal(reloaded.document.querySelector('.story-overlay'), null, 'просмотренный разговор не блокирует продолжение');
  assert.equal(state(reloaded.window, 'state.stagePoints[0]'), 1);
  assert.deepEqual(state(reloaded.window, 'state.inventory'), ['compass']);
  click(reloaded.document, '#dialogue');
  untilChoice(reloaded.document);
  assert.ok(reloaded.document.querySelector('#storyChoiceHelp').textContent.includes(selected));
  click(reloaded.document, '[data-story-choice="2"]');
  click(reloaded.document, '#storySkip');
  assert.equal(JSON.parse(reloaded.window.localStorage.getItem(storageKey)).dialogueChoices.stage_1, 'load');

  const oldSave = { ...saved };
  delete oldSave.dialogueChoices;
  const old = game(oldSave);
  t.after(old.close);
  click(old.document, '#mPlay');
  assert.equal(state(old.window, 'state.stagePoints[0]'), 1);
  assert.deepEqual(state(old.window, 'state.done'), [0]);
  click(old.document, '#dialogue');
  untilChoice(old.document);
  click(old.document, '[data-story-choice="0"]');
  click(old.document, '#storySkip');
  assert.equal(state(old.window, 'state.dialogueChoices.stage_1'), 'parts');
  click(old.document, '#menuBtn');
  click(old.document, '#mRestart');
  assert.deepEqual(state(old.window, 'state.dialogueChoices'), {});
  assert.deepEqual(state(old.window, 'state.done'), []);
  assert.deepEqual(first.errors.concat(reloaded.errors, old.errors), []);
});

test('клавиатура: выбор не перехватывает Enter, Tab не покидает диалог, Escape пропускает его', t => {
  const g = game();
  t.after(g.close);
  const { window: w, document: d } = g;
  click(d, '#mPlay');
  untilChoice(d);
  const first = d.querySelector('[data-story-choice="0"]');
  assert.equal(d.activeElement, first);
  assert.equal(key(w, first, 'Enter').defaultPrevented, false, 'браузер сам активирует кнопку по Enter');
  assert.equal(key(w, first, ' ').defaultPrevented, false, 'браузер сам активирует кнопку по пробелу');
  assert.equal(key(w, first, 'Tab', { shiftKey: true }).defaultPrevented, true);
  assert.equal(d.activeElement.id, 'storySkip');
  assert.equal(key(w, d.activeElement, 'Tab').defaultPrevented, true);
  assert.equal(d.activeElement, first);

  key(w, first, 'Escape');
  assert.ok(d.querySelector('#beginAdventure'), 'Escape выполняет тот же переход, что и пропуск');
  assert.equal(state(w, 'state.prologueSeen'), true);
  assert.deepEqual(state(w, 'state.dialogueChoices'), {}, 'пропуск не выбирает ответ');
  click(d, '#beginAdventure');
  untilChoice(d);
  key(w, d.activeElement, 'Escape');
  assert.equal(d.querySelector('.story-overlay'), null);
  assert.equal(state(w, 'state.storySeen[0]'), true);

  d.querySelector('#dialogue').focus();
  click(d, '#dialogue');
  untilChoice(d);
  click(d, '[data-story-choice="1"]');
  assert.equal(d.activeElement.id, 'storyNext');
  key(w, d.activeElement, 'Escape');
  assert.equal(d.querySelector('.story-overlay'), null);
  assert.equal(d.activeElement.id, 'dialogue', 'фокус возвращается к кнопке разговора');
  assert.equal(state(w, 'state.dialogueChoices.stage_0'), 'mistake');
  assert.equal(state(w, 'state.checkAttempts[0]'), 0);
  assert.deepEqual(g.errors, []);
});

test('отмена перемещения не стирает выбор, сделанный после снимка состояния', t => {
  const g = game();
  t.after(g.close);
  const { window: w, document: d } = g;
  readyAtStation(d);
  w.eval('undo=JSON.stringify(state)');
  click(d, '#dialogue');
  untilChoice(d);
  click(d, '[data-story-choice="1"]');
  click(d, '#storySkip');
  key(w, d.body, 'z', { ctrlKey: true });
  assert.equal(state(w, 'state.dialogueChoices.stage_0'), 'mistake');
  assert.equal(JSON.parse(w.localStorage.getItem(storageKey)).dialogueChoices.stage_0, 'mistake');
  assert.deepEqual(g.errors, []);
});

test('после диалога первый тест проходится и открывает разговор следующего этапа', async t => {
  const g = game();
  t.after(g.close);
  const { window: w, document: d } = g;
  click(d, '#mPlay');
  click(d, '#storySkip');
  click(d, '#beginAdventure');
  untilChoice(d);
  click(d, '[data-story-choice="0"]');
  finishStory(d);
  assert.equal(state(w, 'state.checkAttempts[0]'), 0);

  for (let i = 0; i < 5; i++) {
    const correct = state(w, 'state.t1questions[state.t1q].c');
    const radio = d.querySelector(`input[name="t1ans"][value="${correct}"]`);
    radio.checked = true;
    radio.dispatchEvent(new w.Event('change', { bubbles: true }));
    click(d, i < 4 ? '#t1next' : '#t1submit');
  }
  assert.match(d.querySelector('.test-result').textContent, /Верно 5 из 5/);
  click(d, '#check');
  assert.equal(state(w, 'state.checkAttempts[0]'), 1);
  assert.equal(state(w, 'state.stagePoints[0]'), 1);
  assert.deepEqual(state(w, 'state.done'), [0]);
  click(d, '#reviewContinue');
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(state(w, 'state.task'), 1);
  assert.equal(d.querySelector('#storySpeaker').textContent, 'Болок');
  untilChoice(d);
  click(d, '[data-story-choice="1"]');
  assert.match(d.querySelector('#storyText').textContent, /витков и силы тока/);
  finishStory(d);
  assert.equal(state(w, 'state.checkAttempts[1]'), 0);
  assert.deepEqual(g.errors, []);
});

test('выбор сохраняется сразу, даже если перезагрузить игру до окончания разговора', t => {
  const first = game();
  t.after(first.close);
  click(first.document, '#mPlay');
  untilChoice(first.document);
  const selected = optionText(first.document.querySelector('[data-story-choice="0"]'));
  click(first.document, '[data-story-choice="0"]');
  const saved = JSON.parse(first.window.localStorage.getItem(storageKey));
  assert.equal(saved.prologueSeen, false);
  assert.equal(saved.dialogueChoices.prologue, 'storm');

  const reloaded = game(saved);
  t.after(reloaded.close);
  click(reloaded.document, '#mPlay');
  untilChoice(reloaded.document);
  assert.ok(reloaded.document.querySelector('#storyChoiceHelp').textContent.includes(selected));
  click(reloaded.document, '[data-story-choice="2"]');
  finishStory(reloaded.document);
  assert.ok(reloaded.document.querySelector('#beginAdventure'));
  assert.equal(state(reloaded.window, 'state.dialogueChoices.prologue'), 'unsure');
  assert.deepEqual(first.errors.concat(reloaded.errors), []);
});

test('начало новой истории с карты снова открывает предысторию и первый диалог', t => {
  const g = game();
  t.after(g.close);
  const { window: w, document: d } = g;
  readyAtStation(d);
  click(d, '#dialogue');
  untilChoice(d);
  click(d, '[data-story-choice="0"]');
  click(d, '#storySkip');
  click(d, '#mapBtn');
  click(d, '#restartGame');
  assert.match(d.querySelector('.story-overlay').getAttribute('aria-label'), /Предыстория/);
  assert.deepEqual(state(w, 'state.dialogueChoices'), {});
  click(d, '#storySkip');
  assert.ok(d.querySelector('#beginAdventure'));
  click(d, '#beginAdventure');
  assert.equal(d.querySelector('#storySpeaker').textContent, 'Мира');
  untilChoice(d);
  assert.equal(d.querySelector('#storyChoiceHelp').textContent.includes('В прошлый раз'), false);
  click(d, '#storySkip');
  assert.equal(state(w, 'state.prologueSeen'), true);
  assert.equal(state(w, 'state.storySeen[0]'), true);
  assert.deepEqual(g.errors, []);
});

test('кнопка «Начать заново» во вступлении тоже запускает новую предысторию', t => {
  const g = game();
  t.after(g.close);
  const { window: w, document: d } = g;
  readyAtStation(d);
  w.eval("state.done=[0];state.task=1;state.dialogueChoices={stage_0:'theory'};render();showIntro()");
  click(d, '#startFresh');
  assert.match(d.querySelector('.story-overlay').getAttribute('aria-label'), /Предыстория/);
  assert.deepEqual(state(w, 'state.dialogueChoices'), {});
  click(d, '#storySkip');
  click(d, '#beginAdventure');
  untilChoice(d);
  assert.equal(d.querySelector('#storySpeaker').textContent, 'Мира');
  assert.deepEqual(g.errors, []);
});

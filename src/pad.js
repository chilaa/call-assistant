// The small pad only shows what the main window tells it.
const api = window.callClips;
const $ = (id) => document.getElementById(id);
let last = null;

function row(clip) {
  const button = document.createElement('button');
  button.className = 'pad-row';
  button.dataset.id = clip.id;
  if (clip.color) {
    button.classList.add('colored');
    button.style.setProperty('--tile', clip.color);
    button.style.setProperty('--clip-color', clip.color);
  }
  if (clip.playing) button.classList.add('playing');
  if (clip.next) button.classList.add('is-next');
  if (clip.played) button.classList.add('played');
  button.title = clip.name;
  button.addEventListener('click', () => api.padPlay(clip.id));

  const fill = document.createElement('span');
  fill.className = 'fill';
  if (clip.playing) fill.style.setProperty('--progress', `${clip.progress || 0}%`);
  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = clip.played ? '✓' : clip.number;
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = clip.name;
  button.append(fill, num, name);
  if (clip.shortcut) {
    const key = document.createElement('kbd');
    key.textContent = clip.shortcut;
    button.append(key);
  }
  return button;
}

function render(state) {
  last = state;
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.lang = state.lang;
  document.title = state.words.title;
  $('onTopLabel').textContent = state.words.onTop;
  $('onTop').checked = state.onTop;
  $('nextBtn').textContent = state.nextLabel;
  $('nextBtn').disabled = !state.nextEnabled;
  $('stopBtn').textContent = state.words.stop;
  for (const el of [$('nextBtn'), $('stopBtn'), $('onTopLabel')]) {
    el.style.fontSize = '';
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth && size > 10) {
      size -= 1;
      el.style.fontSize = `${size}px`;
    }
  }
  $('stopBtn').disabled = !state.playing;

  const list = $('list');
  list.replaceChildren();
  if (!state.clips.length && !state.always.length) {
    const empty = document.createElement('p');
    empty.className = 'pad-empty';
    empty.textContent = state.words.empty;
    list.append(empty);
  }
  state.clips.forEach((clip) => list.append(row(clip)));
  if (state.always.length) {
    const title = document.createElement('p');
    title.className = 'pad-side';
    title.textContent = state.words.always;
    list.append(title);
    state.always.forEach((clip) => list.append(row(clip)));
  }
}

// Only the moving bar changes while a clip plays, so the list stays still.
function renderProgress(state) {
  const playing = state.clips.concat(state.always).find((clip) => clip.playing);
  const el = playing && document.querySelector(`.pad-row[data-id="${playing.id}"] .fill`);
  if (el) el.style.setProperty('--progress', `${playing.progress || 0}%`);
}

api.onPadState((state) => {
  if (state.progressOnly && last) renderProgress(state);
  else render(state);
});
$('onTop').addEventListener('change', (e) => api.padOnTop(e.target.checked));
$('nextBtn').addEventListener('click', () => api.padAction('next'));
$('stopBtn').addEventListener('click', () => api.padAction('stop'));
api.padReady().then((state) => { if (state) render(state); });

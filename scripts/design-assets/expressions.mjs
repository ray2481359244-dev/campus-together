// Original expressions. Hair, brows, eyes, mouths and gestures tell different stories.
export const poses = ['default', 'think', 'cheer', 'wave', 'seated'];
export function expression(kind, pose) {
  let mood = { violet: 'bright', blue: 'calm', pink: 'wink', green: 'laugh' }[kind];
  if (pose === 'think') mood = 'think';
  if (pose === 'cheer') mood = 'laugh';
  if (pose === 'wave') mood = kind === 'pink' ? 'laugh' : 'wink';
  const eye = x => `<ellipse cx="${x}" cy="91" rx="8.6" ry="13" fill="#493c43" stroke="none"/><ellipse cx="${x + 2.7}" cy="86.3" rx="3.5" ry="4.7" fill="#fffdf8" stroke="none"/><ellipse cx="${x - 1}" cy="99" rx="3" ry="2" fill="#ee9da9" stroke="none"/>`;
  const closed = x => `<path d="M${x - 9} 94q9-13 18 0" fill="none" stroke-width="3.2"/>`;
  let eyes, mouth, brows;
  if (mood === 'wink') {
    eyes = `${eye(72)}<path d="m122 87 15 6-14 4" fill="none" stroke-width="3.2"/>`;
    mouth = '<path d="M83 111q21 10 39-2c-2 23-31 22-39 2Z" fill="#7b4659" stroke-width="2.2"/><path d="M91 122q13-8 23 0" fill="#f2a6b6" stroke="none"/>';
    brows = '<path d="m65 72 13 1m46-2q7-3 14 0" fill="none" stroke-width="2"/>';
  } else if (mood === 'calm') {
    eyes = closed(72) + closed(131);
    mouth = '<path d="M90 112q12 10 25-2" fill="none" stroke-width="2.5"/>';
    brows = '<path d="m64 74 14-1m46 0 14 1" fill="none" stroke-width="1.8"/>';
  } else if (mood === 'laugh') {
    eyes = '<path d="m63 85 14 8-14 5m77-13-14 8 14 5" fill="none" stroke-width="3"/>';
    mouth = '<path d="M80 111q20 6 42-1c-2 27-36 26-42 1Z" fill="#7b4659" stroke-width="2.2"/><path d="M84 113q18 4 34-1l-3 7H89Z" fill="#fffdf8" stroke="none"/><path d="M91 129q12-10 22-1" fill="#f0a2b2" stroke="none"/>';
    brows = '<path d="m63 74 13-3m49 0 13 3" fill="none" stroke-width="2"/>';
  } else if (mood === 'think') {
    eyes = eye(74) + '<path d="M123 92q9 6 17-1" fill="none" stroke-width="3"/>';
    mouth = '<path d="M94 115q7-5 15-1" fill="none" stroke-width="2.5"/>';
    brows = '<path d="m65 73 15-3m44 3 14 4" fill="none" stroke-width="2"/>';
  } else {
    eyes = eye(72) + eye(131);
    mouth = '<path d="M86 112q14 5 29-2c1 21-25 24-29 2Z" fill="#7b4659" stroke-width="2.2"/><path d="M93 123q9-6 16-1" fill="#f0a2b2" stroke="none"/>';
    brows = '<path d="m63 73 15-4m45 4q8-4 15 0" fill="none" stroke-width="2.2"/>';
  }
  const glasses = kind === 'blue' ? '<g fill="none" stroke="#7a657f" stroke-width="1.8"><rect x="55" y="80" width="35" height="25" rx="11"/><rect x="112" y="80" width="35" height="25" rx="11"/><path d="M90 90q11-7 22 0m-58-1-12-3m106 3 12-3"/></g>' : '';
  return `<g class="face-expression expression-${mood}">${brows}<g class="pupils">${eyes}</g>${glasses}<ellipse cx="49" cy="109" rx="12" ry="5" fill="#f4b9ba" stroke="none" opacity=".8"/><ellipse cx="151" cy="109" rx="12" ry="5" fill="#f4b9ba" stroke="none" opacity=".8"/>${mouth}</g>`;
}

export function seatedLegs(kind) {
  const female = kind === 'pink' || kind === 'blue';
  const legs = female
    ? `<path d="M71 187c-6 7-5 14-1 20l-1 12q8 5 17 0l2-18 3-14Z" fill="#ffe9e1"/><path d="M111 187l2 16 3 16q9 4 17-1l-4-18 1-13Z" fill="#ffe9e1"/><path d="m70 209 16 1-1 10-15 1Zm44 1 16-1 3 10-16 2Z" fill="#7b90aa"/><path d="M66 172q35 12 69 0l8 20q-44 13-85 0Z" fill="${kind === 'pink' ? '#b2a0cf' : '#dbadbf'}"/><path d="m80 180-3 14m22-13v15m22-17 4 15" stroke="#9380b2" stroke-width="2"/>`
    : `<path d="M67 174q31 11 66 0l6 16q4 9-5 14l-1 15-17 1-3-20q-2-8-13-10-10 3-11 10l-3 20-18-1-2-17q-8-4-5-13Z" fill="#8190a6"/><path d="M100 190v-9m-34 20 15 2m39 0 14-2" fill="none" stroke="#66768d" stroke-width="2"/>`;
  return `<g class="seated-legs">${legs}<path d="M69 216q8 3 17 1l1 10q-16 7-31 2c-2-5 6-10 13-13Z" fill="${female ? '#536d8a' : '#fff8f0'}"/><path d="M116 217q8 2 17-1c7 3 14 8 12 13q-14 5-30-2Z" fill="${female ? '#536d8a' : '#fff8f0'}"/><path d="m58 227 26-2m33 0 25 2" stroke="${female ? '#fff9ef' : '#9d91a0'}" stroke-width="2"/></g>`;
}
export function seatedHands(kind, shirt) {
  // Each sleeve is one closed shoulder → elbow → cuff contour; the palm overlaps the cuff.
  if (kind === 'violet') return `<g class="left-arm"><path d="M68 133c-10 1-18 9-18 19l9 24q4 8 12 4l21-9-5-11-16 6-5-16 11-10Z" fill="${shirt}"/><path d="M87 161c8-4 13-4 16 0q3 4-4 7l-6 4q-5 4-10 0l-1-6Z" fill="#ffe9e1"/><path d="m86 160 5 12" fill="none" stroke-width="2"/></g><g class="right-arm"><path d="M129 133q15 4 19 21l-9 24-14-5 8-19-10-10Z" fill="${shirt}"/><path d="M126 172q8-3 13 2l-2 7-8 4q-6 0-7-5Z" fill="#ffe9e1"/><path d="m125 172 12 5" stroke-width="2"/></g><g class="writing-note"><path d="m93 181 61 8-4 30-62-8Z" fill="#fffaf0"/><path d="m102 193 38 5m-39 3 31 4" stroke="#b4a4ba" stroke-width="1.8"/><path d="m132 179 12 21" stroke="#8c78a7" stroke-width="4"/><path d="m143 199 4 7-1-8" fill="#fff9ef" stroke-width="1.2"/></g><path d="M127 173q7-3 10 2l-2 7q-6 3-10-1Z" fill="#ffe9e1"/><path d="m130 178 4 1" stroke-width="1.5"/>`;
  if (kind === 'blue') return `<g class="left-arm"><path d="M68 133q-15 5-18 23l9 26 15-5-9-22 12-13Z" fill="${shirt}"/><path d="m60 171 13 5" stroke-width="2"/></g><g class="right-arm"><path d="M129 133q17 5 20 23l-10 26-14-6 9-20-12-13Z" fill="${shirt}"/><path d="m126 175 13-5" stroke-width="2"/></g><g class="held-book"><path d="M64 177q18-6 37 3 18-8 37-2l-2 32q-18-5-35 2-18-8-36-3Z" fill="#fffaf0"/><path d="m101 181 0 28m-28-21 18 3m-18 5 18 3m19-12 18-3m-18 11 18-3" stroke="#aa96b4" stroke-width="1.7"/><path d="M60 178q5-3 9 1l3 7q0 6-6 6l-9-5q-4-5 3-9Zm80 0q-6-3-9 2l-3 6q0 6 6 6l8-5q4-5-2-9Z" fill="#ffe9e1"/><path d="m64 182 5 4m67-4-5 4" stroke-width="1.5"/></g>`;
  if (kind === 'pink') return `<g class="left-arm"><path d="M69 133c-11 2-17 10-15 20l7 14q4 7 12 4l18-5-4-12-15 5-4-10 9-9Z" fill="${shirt}"/><path d="m84 155 4 13" stroke-width="2"/></g><g class="right-arm"><path d="M129 133q13 4 17 19l-7 15q-3 6-10 3l-9-6 6-11 6 4 2-7-11-9Z" fill="${shirt}"/><path d="m123 153-5 11" stroke-width="2"/></g><g class="held-phone"><rect x="91" y="151" width="35" height="26" rx="4" fill="#a68ac9"/><rect x="95" y="155" width="27" height="15" rx="2" fill="#eee3ff" stroke="none"/><circle cx="109" cy="174" r="1.3" fill="#fff9ef" stroke="none"/><path d="M85 157q6-3 10 0l3 5q1 4-3 5l-3 0 2 3q-1 5-7 2l-5-6Z" fill="#ffe9e1"/><path d="M130 157q-6-3-10 1l-3 4q-1 4 3 5h3l-2 3q1 5 7 2l5-6Z" fill="#ffe9e1"/><path d="m90 162 4 1m31 0 3-1" stroke-width="1.5"/></g>`;
  return `<g class="left-arm"><path d="M68 133q-15 5-18 22l9 16 16-8-5-11 8-11Z" fill="${shirt}"/><path d="m61 157 11 10" stroke-width="2"/></g><g class="right-arm"><path d="M129 133q16 5 21 22l-9 17-16-8 6-12-10-10Z" fill="${shirt}"/><path d="m128 166 11-9" stroke-width="2"/></g><g class="held-map"><path d="m74 155 17 3 17-4 18 3 7 24-22-3-18 4-23-4Z" fill="#f6e79d"/><path d="m91 158 2 24m15-28 3 24" stroke="#c1ac69" stroke-width="1.5"/><path d="m80 172 8-8 10 10 13-11 13 10" stroke="#97a777" stroke-width="2" fill="none"/><path d="M66 161q6-5 11 0l3 5q1 5-4 6l-7-1-6-5Z" fill="#ffe9e1"/><path d="M136 161q-6-5-11 0l-3 5q-1 5 4 6l7-1 6-5Z" fill="#ffe9e1"/><path d="m72 165 5 2m48 0 5-2" stroke-width="1.5"/></g>`;
}

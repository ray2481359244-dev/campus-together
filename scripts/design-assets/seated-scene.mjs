import { character } from './characters.mjs';

// Position is shared by the body and its foreground arms. The table is the only occluding layer.
const placement = {
  violet: [307, 202, -3, 1.05], blue: [553, 219, 3, 1.04],
  pink: [158, 323, -3, 1.13], green: [751, 324, 3, 1.1]
};
function person(kind, layer = 'all') {
  const [x,y,angle,scale] = placement[kind];
  const art = character(kind,'student-art','seated',layer).replace(/^<svg[^>]*>/,'').replace(/<\/svg>$/,'');
  const chair = layer === 'arms' ? '' : `<g class="meeting-chair" stroke="#b4a398" stroke-width="3" fill="#eee0d3"><rect x="47" y="139" width="107" height="46" rx="15"/><path d="M60 186v44m80-44v44" stroke-width="7" fill="none"/><path d="M49 181q52 12 105 0v12q-51 13-105 0Z" fill="#d2bba6"/></g>`;
  return `<g class="meeting-person person-${kind}${layer === 'arms' ? ' meeting-foreground-arms' : ''}" transform="translate(${x} ${y}) rotate(${angle} 100 150) scale(${scale})">${chair}<g class="person-bob">${art}</g></g>`;
}
export function meetingScene() {
  return `<svg class="meeting-illustration" viewBox="0 0 1100 650" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g stroke-linecap="round" stroke-linejoin="round">
    <ellipse cx="550" cy="603" rx="373" ry="28" fill="#a18da9" opacity=".09"/>
    <g class="conversation-marks" stroke="#aa8fbb" stroke-width="2.5"><path d="m330 340-12-6m19-3-3-12m306 22 10-8m-12-1 1-12m-350 112-12-6m535 3 12-8"/></g>
    ${person('violet','base')}${person('blue','base')}
    <g class="meeting-table" transform="translate(0 30)" stroke="#68515b" stroke-width="3.2">
      <path d="m335 444-19 124q10 14 24 0l34-108m352-14 32 121q11 10 22-3l-18-121" fill="#bfac9d"/>
      <path d="M245 443c2 106 614 117 615-2v-19H245Z" fill="#d9bfa6"/>
      <ellipse cx="552" cy="422" rx="309" ry="83" fill="#f4ddbd"/>
      <ellipse cx="552" cy="416" rx="298" ry="75" fill="#ffeace" stroke="#ddc3a4" stroke-width="1.5"/>
      <g class="table-notes"><path d="m558 435 45-5 4 27-45 5Z" fill="#d3e7bd"/><path d="m688 429 40 8-6 22-40-8Z" fill="#f6bdcf"/><path d="m413 449 37-5 3 23-38 3Z" fill="#cfe8fb"/><path d="m584 397 32 5-3 22-33-6Z" fill="#ddd0ff"/>
      <path d="M736 375v27q18 10 35 0v-27" fill="#fffaf1"/><ellipse cx="753" cy="375" rx="17" ry="6" fill="#ead3b6"/><path d="M773 378c21-3 19 22-1 19" fill="none"/><path d="M750 358q-9-10 0-19" stroke="#bfa4b6" stroke-width="2" fill="none"/></g>
    </g>
    ${person('violet','arms')}${person('blue','arms')}
    ${person('pink')}${person('green')}
    <g fill="#fffcf2" stroke="#9b87ac" stroke-width="2"><path d="m515 292 5 12 12 4-12 5-5 12-4-12-13-5 13-4Z"/><path d="m561 319 3 6 6 2-6 3-3 6-2-6-6-3 6-2Z"/></g>
    <path d="M440 570q125 31 225-2" stroke="#c5aaba" stroke-width="1.5" stroke-dasharray="3 8"/>
  </g></svg>`;
}

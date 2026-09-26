// Bodycam HUD (DOM): vitals, weapon/ammo, kill feed, hit markers, damage & grenade indicators,
// toasts, streak callouts, scoreboard, death card, end-of-match report.
import { WEAPONS, FIRE_MODE_LABEL, GRENADE } from './shared/weapons.js';
import { settings, keyLabel } from './settings.js';

const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const short = (w) => (w === 'nade' ? GRENADE.short : WEAPONS[w]?.short || w);
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Hud {
  constructor() {
    this.el = {};
    for (const id of ['hud', 'clock', 'serial', 'timer', 'kd', 'feed', 'xhair', 'hitmark', 'dmg', 'nadewarn', 'aimname', 'prompt', 'toasts', 'streak',
      'hp', 'hpbar', 'ar', 'arbar', 'stbar', 'stam', 'wname', 'wmode', 'mag', 'res', 'slots', 'banner', 'death', 'killer', 'killinfo', 'respawn',
      'score', 'scorebody', 'fraglimit', 'endscreen', 'fps', 'cook', 'protect', 'weapon']) this.el[id] = $(id);
    this.cache = {};
    this.nadeEls = [];
  }
  set(id, key, v) { if (this.cache[id + key] === v) return; this.cache[id + key] = v; if (key === 'text') this.el[id].textContent = v; else if (key === 'html') this.el[id].innerHTML = v; else this.el[id].style[key] = v; }
  show(on) { this.el.hud.classList.toggle('hidden', !on); }

  clock(serial) {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    this.set('clock', 'text', `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`);
    if (serial) this.set('serial', 'text', serial);
  }
  match(timeLeft, kills, deaths, lead, fragLimit, team) {
    this.set('timer', 'text', timeLeft == null ? '--:--' : mmss(timeLeft));
    this.el.timer.classList.toggle('low', timeLeft != null && timeLeft <= 30);
    if (team) this.set('kd', 'html', `<span class="t0${team.mine === 0 ? ' mine' : ''}">MAVİ ${team.score[0]}</span> · <span class="t1${team.mine === 1 ? ' mine' : ''}">${team.score[1]} KIRMIZI</span> <span class="lim">/ ${fragLimit}</span><br>LEŞ ${kills} · ÖLÜM ${deaths}`);
    else this.set('kd', 'text', `LEŞ ${kills} · ÖLÜM ${deaths} · LİDER ${lead}/${fragLimit}`);
  }
  vitals(hp, armor, stamina) {
    this.set('hp', 'text', String(Math.ceil(hp))); this.set('hpbar', 'width', `${hp}%`);
    this.set('hpbar', 'background', hp < 35 ? '#ff5a4a' : '#e9e4d4');
    this.set('ar', 'text', String(Math.ceil(armor))); this.set('arbar', 'width', `${armor}%`);
    this.set('stbar', 'width', `${stamina * 100}%`);
    this.set('stam', 'opacity', stamina < 0.995 ? '1' : '0');
  }
  weapon(type, mode, mag, res, reloading, cap) {
    const w = WEAPONS[type];
    this.set('wname', 'text', w.label + (reloading ? ' · ŞARJÖR DEĞİŞİYOR' : ''));
    this.set('wmode', 'text', FIRE_MODE_LABEL[mode] || '');
    this.set('mag', 'text', w.melee ? '—' : String(mag));
    this.set('res', 'text', w.melee ? '' : String(res));
    this.el.mag.classList.toggle('low', !w.melee && mag <= Math.ceil(cap * 0.25));
    this.el.weapon.classList.toggle('melee', !!w.melee);
  }
  slots(inv, slot) {
    const parts = [];
    const B = settings.binds;
    if (inv.primary) parts.push(`<span class="${slot === 'primary' ? 'on' : ''}"><b>${keyLabel(B.slot1)}</b>${short(inv.primary.w)}</span>`);
    parts.push(`<span class="${slot === 'secondary' ? 'on' : ''}"><b>${keyLabel(B.slot2)}</b>${short(inv.secondary.w)}</span>`);
    parts.push(`<span class="${slot === 'melee' ? 'on' : ''}"><b>${keyLabel(B.slot3)}</b>BIÇAK</span>`);
    parts.push(`<span class="${inv.nades ? '' : 'off'}"><b>${keyLabel(B.nade)}</b>M67 ×${inv.nades}</span>`);
    this.set('slots', 'html', parts.join(''));
  }
  crosshair(on) { this.set('xhair', 'display', on ? '' : 'none'); }
  prompt(html) { this.set('prompt', 'display', html ? 'block' : 'none'); if (html) this.set('prompt', 'html', html); }
  aimName(n, friend) { this.set('aimname', 'text', n || ''); this.el.aimname.classList.toggle('friend', !!friend); }
  protect(on) { this.set('protect', 'display', on ? 'block' : 'none'); }
  cook(k) { this.set('cook', 'display', k > 0 ? 'block' : 'none'); if (k > 0) this.el.cook.style.setProperty('--k', k.toFixed(3)); }
  fps(on, v) { this.set('fps', 'display', on ? 'block' : 'none'); if (on) this.set('fps', 'text', `${v} FPS`); }

  // kind: 'b' body, 'h' head, 'plate', 'kill', 'killh'
  hitmarker(kind) {
    const h = this.el.hitmark;
    h.className = '';
    void h.offsetWidth; // restart the CSS animation
    h.className = 'show ' + kind;
  }
  damage(rel, dmg) {
    const d = document.createElement('div');
    d.className = 'arc';
    d.style.transform = `rotate(${-rel}rad)`;
    d.style.setProperty('--a', Math.min(1, 0.45 + dmg / 50).toFixed(2));
    this.el.dmg.appendChild(d);
    while (this.el.dmg.children.length > 5) this.el.dmg.firstChild.remove();
    setTimeout(() => d.remove(), 1500);
  }
  // list of [relative angle, closeness 0..1]
  nades(list) {
    while (this.nadeEls.length < list.length) { const e = document.createElement('div'); e.className = 'nade'; e.innerHTML = '<i>✹</i>'; this.el.nadewarn.appendChild(e); this.nadeEls.push(e); }
    this.nadeEls.forEach((e, i) => {
      if (i >= list.length) { e.style.display = 'none'; return; }
      const [rel, k] = list[i];
      e.style.display = 'block';
      e.style.transform = `rotate(${-rel}rad) translateY(-17vh) rotate(${rel}rad)`;
      e.style.opacity = (0.5 + k * 0.5).toFixed(2);
      e.classList.toggle('near', k > 0.6);
    });
  }
  feed(k, v, w, zone, myId, names, myTeam = null) {
    const tc = (id) => (myTeam == null ? '' : names.get(id)?.team === myTeam ? 'fr' : 'en');
    const kn = `<span class="${tc(k)}">${esc(names.get(k)?.name || '?')}</span>`, vn = `<span class="${tc(v)}">${esc(names.get(v)?.name || '?')}</span>`;
    const div = document.createElement('div');
    if (k === myId || v === myId) div.className = 'me';
    const tag = zone === 'h' ? ' ⌖' : zone === 'back' ? ' ✦' : '';
    div.innerHTML = k === v ? `${vn} <span class="w">[${short(w)}]</span> ☠` : `${kn} <span class="w ${zone === 'h' || zone === 'back' ? 'hs' : ''}">[${short(w)}${tag}]</span> ${vn}`;
    this.el.feed.prepend(div);
    while (this.el.feed.children.length > 6) this.el.feed.lastChild.remove();
  }
  toast(text, cls = '') {
    const d = document.createElement('div');
    d.textContent = text;
    if (cls) d.className = cls;
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    setTimeout(() => d.remove(), 2400);
  }
  streak(text) {
    const s = this.el.streak;
    s.textContent = text;
    s.className = '';
    void s.offsetWidth;
    s.className = 'show';
  }
  banner(text) { this.set('banner', 'text', text || ''); }
  death(show, killer = '', info = '') {
    this.el.death.classList.toggle('hidden', !show);
    if (show) { this.el.killer.textContent = killer; this.el.killinfo.textContent = info; }
  }
  respawn(t) { this.set('respawn', 'text', t > 0 ? `Yeniden doğma: ${t.toFixed(1)} sn` : 'Kamera yeniden başlatılıyor…'); }
  scoreboard(show, rows, myId, fragLimit, ping, team) {
    this.el.score.classList.toggle('hidden', !show);
    if (!show) return;
    const row = (r, i) => `<tr class="${r.id === myId ? 'me' : ''}${r.alive === false ? ' dead' : ''}"><td>${i + 1}</td><td>${esc(r.name)} ${r.bot ? '<span class="bot">BOT</span>' : ''}</td><td>${r.k}</td><td>${r.d}</td><td>${r.hs}</td></tr>`;
    if (team) {
      const order = team.mine === 1 ? [1, 0] : [0, 1];
      this.el.scorebody.innerHTML = order.map((t) => `<tr class="thead t${t}"><td></td><td>${t === 0 ? 'MAVİ TAKIM' : 'KIRMIZI TAKIM'}${t === team.mine ? ' (SİZ)' : ''}</td><td colspan="3">${team.score[t]}</td></tr>` + rows.filter((r) => r.team === t).map(row).join('')).join('');
      this.el.fraglimit.textContent = `${fragLimit} skora ulaşan takım kazanır.` + (ping != null ? `  ·  Gecikme: ${ping} ms` : '');
      return;
    }
    this.el.scorebody.innerHTML = rows.map(row).join('');
    this.el.fraglimit.textContent = `İlk ${fragLimit} leşe ulaşan maçı kazanır.` + (ping != null ? `  ·  Gecikme: ${ping} ms` : '');
  }
  endScreen(data, myId, myTeam = -1) {
    const e = this.el.endscreen;
    if (!data) { e.classList.add('hidden'); return; }
    const place = data.table.findIndex((r) => r.id === myId) + 1;
    const me = data.table.find((r) => r.id === myId);
    const tdm = data.mode === 'tdm';
    const won = tdm ? data.winnerTeam === myTeam : data.winner === myId;
    const title = tdm
      ? (data.winnerTeam < 0 ? 'BERABERE' : won ? 'TAKIMIN KAZANDI' : `${data.winnerTeam === 0 ? 'MAVİ' : 'KIRMIZI'} TAKIM KAZANDI`) + ` · ${data.teamScore[0]} — ${data.teamScore[1]}`
      : won ? 'MAÇI KAZANDIN' : `${esc(data.name || '—')} MAÇI KAZANDI`;
    e.innerHTML = `<div class="panel end">
      <div class="endtitle ${won ? 'won' : ''}">${title}</div>
      <div class="endsub">${place ? `${place}. SIRA` : ''}${me ? ` · ${me.k} LEŞ · ${me.d} ÖLÜM · %${me.acc} İSABET · ${me.hs} KAFADAN · EN İYİ SERİ ${me.best}` : ''}</div>
      <table><thead><tr><th>#</th><th>OPERATÖR</th><th>LEŞ</th><th>ÖLÜM</th><th>KAFA</th><th>İSABET</th><th>HASAR</th></tr></thead><tbody>
      ${data.table.map((r, i) => `<tr class="${r.id === myId ? 'me' : ''}"><td>${i + 1}</td><td>${tdm ? `<span class="tdot t${r.team}"></span>` : ''}${esc(r.name)} ${r.bot ? '<span class="bot">BOT</span>' : ''}</td><td>${r.k}</td><td>${r.d}</td><td>${r.hs}</td><td>%${r.acc}</td><td>${r.dmg}</td></tr>`).join('')}
      </tbody></table>
      <div class="endnext">Yeni seviye üretiliyor: <span id="endcount">${data.next}</span> sn</div></div>`;
    e.classList.remove('hidden');
  }
  endCount(s) { const c = document.getElementById('endcount'); if (c) c.textContent = Math.max(0, Math.ceil(s)); }
}

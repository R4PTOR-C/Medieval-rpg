// Loop principal: render (cena -> textura -> ASCII), entrada, combate, HUD.
import * as THREE from 'three';
import { rand, rr, ri, clamp } from './util.js';
import { RUINS, FIRE, SPAWN, ELDER, heightAt, groundY, canStand, moveEntity, colliders } from './terrain.js';
import { buildWorld } from './world.js';
import { cutout } from './geo.js';
import { createAscii } from './ascii.js';
import { makeKnight, makeSkeleton, makeWolf, makeElder, poseHumanoid, poseWolf, poseElder, poseKneel, animateCape, ATTACKS } from './models.js';
import { createFx } from './fx.js';
import { COMBAT } from './combatConfig.js';
import { initAudio, toggleMute, sfx } from './audio.js';
import { createBloom } from './post.js';

// =====================================================================
// renderer e cena
// =====================================================================
const NEAR = 0.1, FAR = 700;
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02040c);
scene.fog = new THREE.FogExp2(0x0c1840, 0.016);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, NEAR, FAR);
camera.layers.enable(1); // camada 1 = grama/flores (não entra no reflexo da água)

const sceneRT = new THREE.WebGLRenderTarget(innerWidth, innerHeight);
sceneRT.depthTexture = new THREE.DepthTexture(innerWidth, innerHeight);
const bloom = createBloom(innerWidth, innerHeight);
const ascii = createAscii(sceneRT, NEAR, FAR, bloom.texture);

const world = buildWorld(scene);
const fx = createFx(scene);
const trailA = new THREE.Vector3(), trailB = new THREE.Vector3();

// =====================================================================
// entidades
// =====================================================================
const player = {
  name: 'Sir Roland', x: SPAWN.x, z: SPAWN.z, rot: 0.45, hp: 100, maxHp: 100, level: 1, xp: 0,
  gold: 0, potions: 3, dmg: [10, 16], phase: 0, moveAmt: 0,
  act: null, combo: 0, comboTimer: 0, queued: null, heavyCd: 0, dodgeCd: 0, invuln: 0, kvx: 0, kvz: 0, inDir: null,
  react: null, stun: 0, freeze: 0,
  moveTarget: null, attackTarget: null, talkPending: false, dead: false, deadT: 0, rig: makeKnight(),
};
scene.add(player.rig.root);
const INTRO_ROT = 0.45; // de frente para a câmera, de costas para a lua
const xpNeeded = () => 80 + (player.level - 1) * 70;

const elder = { name: 'Ancião Aldric', x: ELDER.x, z: ELDER.z, rig: makeElder() };
elder.rig.root.position.set(elder.x, heightAt(elder.x, elder.z), elder.z);
elder.rig.root.rotation.y = 0.6;
scene.add(elder.rig.root);
colliders.push({ x: elder.x, z: elder.z, r: 0.45 });

const TYPES = {
  skeleton: { name: 'Esqueleto', hp: 42, dmg: [5, 9], speed: 2.4, xp: 26, gold: [2, 8], aggro: 10, reach: 1.35, cd: 1.6, respawn: 30, make: () => makeSkeleton(), humanoid: true, atkDur: 0.85, atkHit: 0.5 },
  wolf: { name: 'Lobo', hp: 30, dmg: [4, 7], speed: 4.3, xp: 18, gold: [0, 2], aggro: 12, reach: 1.45, cd: 1.2, respawn: 30, make: makeWolf, atkDur: 0.6, atkHit: 0.45 },
  lord: { name: 'Lorde Esqueleto', hp: 260, dmg: [13, 20], speed: 2.7, xp: 220, gold: [60, 100], aggro: 11, reach: 2.1, cd: 1.6, respawn: 120, make: () => makeSkeleton(true), humanoid: true, radius: 0.7, barH: 3.8, atkDur: 1.2, atkHit: 0.55 },
};
const enemies = [];
function spawnEnemy(type, x, z) {
  for (let i = 0; i < 40 && !canStand(x, z, 0.5); i++) { x += rr(-2, 2); z += rr(-2, 2); }
  const t = TYPES[type];
  const e = { type, t, x, z, sx: x, sz: z, rot: rr(0, 6), hp: t.hp, state: 'idle', cd: 0, phase: 0, moveAmt: 0,
    wander: null, wanderT: rr(1, 4), dead: false, deadT: 0, rig: t.make(), bar: null,
    atk: null, react: null, stun: 0, stagger: 0, staggerMax: 1, freeze: 0, flash: 0, kvx: 0, kvz: 0, shattered: false,
    poise: COMBAT.enemies[type].poise, poiseT: 0 };
  scene.add(e.rig.root);
  enemies.push(e); return e;
}
for (let i = 0; i < 9; i++) { const a = rr(0, 6.28), d = rr(3.5, 11); spawnEnemy('skeleton', RUINS.x + Math.cos(a) * d, RUINS.z + Math.sin(a) * d); }
spawnEnemy('lord', RUINS.x, RUINS.z - 3.2);
for (const [cx, cz] of [[42, -18], [44, 18], [-42, -22], [30, 34]]) for (let i = 0; i < 2; i++) spawnEnemy('wolf', cx + rr(-4, 4), cz + rr(-4, 4));

const quest = { stage: 0, kills: 0 };
const pickups = [];

// =====================================================================
// HUD
// =====================================================================
const $ = id => document.getElementById(id);
const logLines = [];
function log(text, cls = '') {
  logLines.push(`<span class="${cls}">${text}</span>`);
  while (logLines.length > 7) logLines.shift();
  $('log').innerHTML = logLines.join('\n');
}
const cdBar = (cd, max) => cd > 0 ? `<span class="c-dim">[${bar(max - cd, max, 6)}]</span>` : '<span class="c-ok">[pronto]</span>';
const bar = (v, max, n) => { const f = Math.round(clamp(v / max, 0, 1) * n); return '#'.repeat(f) + '-'.repeat(n - f); };
function updateHud() {
  const p = player;
  $('stats').innerHTML =
    `<span class="c-acc">${p.name.toUpperCase()}</span>  ·  NV ${p.level}\n` +
    `HP <span class="c-hp">[${bar(p.hp, p.maxHp, 18)}]</span> ${Math.ceil(p.hp)}/${p.maxHp}\n` +
    `XP <span class="c-xp">[${bar(p.xp, xpNeeded(), 18)}]</span> ${p.xp}/${xpNeeded()}\n` +
    `Ouro <span class="c-acc">${p.gold}</span>   Poções <span class="c-hp">${p.potions}</span>   Dano ${p.dmg[0]}-${p.dmg[1]}\n` +
    `Pesado ${cdBar(p.heavyCd, HEAVY_CD)}   Esquiva ${cdBar(p.dodgeCd, DODGE_CD)}`;
  const q = [
    '<span class="c-acc">MISSÃO</span>\nFale com o Ancião Aldric, junto ao poço da vila.',
    `<span class="c-acc">OS MORTOS INQUIETOS</span>\nDestrua esqueletos nas ruínas ao norte.\n<span class="c-ok">${Math.min(quest.kills, 6)}/6</span> esqueletos`,
    '<span class="c-acc">OS MORTOS INQUIETOS</span>\n<span class="c-ok">Volte ao Ancião Aldric.</span>',
    '<span class="c-acc">O LORDE DAS RUÍNAS</span>\nDerrote o Lorde Esqueleto, no coração das ruínas.',
    '<span class="c-acc">O LORDE DAS RUÍNAS</span>\n<span class="c-ok">Volte ao Ancião Aldric.</span>',
    '<span class="c-acc">LIVRE</span>\nAs ruínas estão em silêncio. Explore o reino.',
  ];
  $('quest').innerHTML = q[quest.stage];
}

const floats = [];
// kind: dmg | crit | hurt | heal | gold | level | info (estilos no index.html)
function floatText(text, x, y, z, kind = 'info') {
  const el = document.createElement('div'); el.className = 'float f-' + kind; el.textContent = text;
  document.body.appendChild(el);
  floats.push({ el, pos: new THREE.Vector3(x + rr(-0.3, 0.3), y, z), t: 0 });
}
const tmpV = new THREE.Vector3();
function toScreen(x, y, z) {
  tmpV.set(x, y, z).project(camera);
  return { x: (tmpV.x + 1) / 2 * innerWidth, y: (1 - tmpV.y) / 2 * innerHeight, vis: tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1 };
}

let dialogOpen = false, dialogAction = null;
function openDialog(text, opt, action) {
  dialogOpen = true; dialogAction = action;
  $('dialog').innerHTML = `<b>${elder.name}</b>\n\n${text}\n<span class="opt">[F] ${opt}</span>`;
  $('dialog').style.display = 'block';
}
function closeDialog(accept) {
  dialogOpen = false; $('dialog').style.display = 'none';
  if (accept && dialogAction) dialogAction();
  dialogAction = null; updateHud();
}
$('dialog').addEventListener('mousedown', e => { e.stopPropagation(); closeDialog(true); });

function talkToElder() {
  const p = player;
  if (quest.stage === 0) openDialog('Viajante! Que bom ver um aço honesto por aqui.\nDesde que a lua ficou cheia, os mortos não descansam nas\nruínas ao norte. Siga a estrada e destrua seis esqueletos.\nO povo da vila saberá recompensar.', 'Aceitar', () => { quest.stage = 1; log('Missão aceita: Os Mortos Inquietos', 'c-acc'); });
  else if (quest.stage === 1) openDialog(`Ainda restam mortos andando... (${quest.kills}/6)\nCuidado com o brilho verde no centro das ruínas.`, 'Ok');
  else if (quest.stage === 2) openDialog('Os ossos voltaram ao pó! Tome, você mereceu.\n\nMas há algo pior: o Lorde Esqueleto despertou no coração\ndas ruínas. Enquanto ele existir, os mortos voltarão.', 'Receber recompensa', () => {
    p.gold += 50; p.potions += 2; gainXp(120); quest.stage = 3;
    log('+50 ouro, +2 poções', 'c-acc'); log('Nova missão: O Lorde das Ruínas', 'c-acc');
  });
  else if (quest.stage === 3) openDialog('O Lorde Esqueleto ainda caminha. Leve poções.\nEle é lento, mas cada golpe dele pesa como uma pedra.', 'Ok');
  else if (quest.stage === 4) openDialog('Você conseguiu! A lua brilha mais limpa esta noite.\nO Reino de Ferro tem uma dívida com você, Sir Roland.\n\n(fim da demo — o mundo continua aberto para explorar)', 'Receber recompensa', () => {
    p.gold += 200; p.potions += 3; gainXp(300); quest.stage = 5; log('+200 ouro, +3 poções', 'c-acc');
  });
  else openDialog('Descanse junto à fogueira, herói.', 'Ok');
}
function tryTalk() {
  if (Math.hypot(player.x - elder.x, player.z - elder.z) < 2.6) { player.moveTarget = null; talkToElder(); return true; }
  return false;
}

// =====================================================================
// "game feel": hitstop local/global, tremor de câmera, flash, câmera lenta.
// Os números ficam em COMBAT (combatConfig.js).
// =====================================================================
const feel = { global: 0, globalCd: 0, trauma: 0, slowmo: 0, hurtFlash: 0 };
const addTrauma = v => { feel.trauma = Math.min(1, feel.trauma + v * COMBAT.shake.scale); };

// Congela quem participou do impacto (local) e, em impactos fortes, o mundo
// por um instante (global). Um golpe que acerta vários alvos chama isto uma vez.
function hitstop(kind, entities) {
  const H = COMBAT.hitstop[kind];
  for (const o of entities) o.freeze = Math.max(o.freeze, H.local);
  if (H.global > 0 && (feel.globalCd <= 0 || H.uncapped)) {
    feel.global = Math.max(feel.global, H.uncapped ? H.global : Math.min(H.global, COMBAT.hitstop.maxGlobal));
    feel.globalCd = COMBAT.hitstop.globalCooldown;
  }
  if (H.slowmo) feel.slowmo = H.slowmo;
}

// flash branco por inimigo: troca temporariamente os materiais do rig
const FLASH = new THREE.MeshBasicMaterial({ color: 0xffffff });
function setFlash(rig, on) {
  rig.root.traverse(o => {
    if (!o.isMesh) return;
    if (on) { if (!o.userData.baseMat) o.userData.baseMat = o.material; o.material = FLASH; }
    else if (o.userData.baseMat) o.material = o.userData.baseMat;
  });
}

// empurrão: soma o impulso, mas a velocidade final nunca passa do maior
// impulso envolvido (nem de maxSpeed); golpes em sequência não empilham
function addImpulse(o, dir, imp) {
  const vx = o.kvx + dir.x * imp, vz = o.kvz + dir.z * imp;
  const cap = Math.min(COMBAT.knockback.maxSpeed, Math.max(Math.hypot(o.kvx, o.kvz), imp));
  const l = Math.hypot(vx, vz), k = l > cap ? cap / l : 1;
  o.kvx = vx * k; o.kvz = vz * k;
}
// scale < 1 = superarmadura segurando o golpe: pose mais contida e sem atordoar
function setReaction(o, kind, scale = 1) {
  const R = COMBAT.reaction[kind];
  o.react = { kind, t: 0, dur: R.dur, amount: R.amount * scale, side: rand() < 0.5 ? -1 : 1 };
  if (scale >= 1) o.stun = Math.max(o.stun || 0, R.stun);
}

function gainXp(n) {
  player.xp += n;
  while (player.xp >= xpNeeded()) {
    player.xp -= xpNeeded(); player.level++;
    player.maxHp += 15; player.hp = player.maxHp; player.dmg[0] += 3; player.dmg[1] += 4;
    floatText('NÍVEL ' + player.level + '!', player.x, groundY(player.x, player.z) + 2.8, player.z, 'level');
    log(`*** Você alcançou o nível ${player.level}! ***`, 'c-ok');
    sfx.levelUp();
  }
}

// ---------------------------------------------------------- golpes do herói
const HIT_KIND = { skeleton: 'bone', lord: 'bone', wolf: 'flesh' };
const COMBO = ['slashA', 'slashB', 'finisher'];
const HEAVY_CD = 3.5, DODGE_CD = 0.8;

// aplica um golpe do herói em um inimigo; `contact` = ponto onde a lâmina encostou
function damageEnemy(e, type, dir, contact) {
  const A = COMBAT.attacks[type], C = COMBAT.crit, ET = COMBAT.enemies[e.type];
  const crit = rand() < (A.category === 'heavy' ? C.heavyChance : C.chance);
  const d = Math.round(ri(player.dmg[0], player.dmg[1]) * A.mul * (crit ? C.mul : 1));
  e.hp -= d;
  if (e.state === 'idle' || e.state === 'return') e.state = 'chase';

  // postura: acumula dano até quebrar e cambalear
  e.poiseT = 0;
  e.poise -= A.poiseDmg * (crit ? C.poiseMul : 1);
  addImpulse(e, dir, A.force * (crit ? C.forceMul : 1) / ET.mass);
  const windup = e.atk && !e.atk.done;
  let kind = crit ? 'crit' : A.category === 'heavy' ? 'heavy' : ET.superArmor ? 'armored' : 'light';
  if (e.poise <= 0 && e.hp > 0) {
    e.poise = ET.poise; e.stagger = e.staggerMax = COMBAT.reaction.stagger.dur;
    e.atk = null; e.cd = Math.max(e.cd, COMBAT.reaction.stagger.dur * 0.6);
    if (kind === 'light' || kind === 'armored') kind = 'heavy';
    floatText('cambaleia', e.x, groundY(e.x, e.z) + (e.type === 'lord' ? 3.4 : 2.3), e.z, 'info');
  } else if (windup && !ET.superArmor && kind !== 'light') {
    e.atk = null; e.cd = Math.max(e.cd, COMBAT.reaction.interruptCd);   // golpe forte interrompe a preparação
  }
  setReaction(e, kind, ET.superArmor && e.stagger <= 0 ? COMBAT.reaction.armorScale : 1);

  // feedback no ponto de contato
  e.flash = 0.09; setFlash(e.rig, true);
  const { x: hx, y: hy, z: hz } = contact;
  if (HIT_KIND[e.type] === 'bone') {
    fx.burst(hx, hy, hz, { n: 10, color: 0xe8e0c8, speed: 3, life: 0.5, dir, spread: 0.8 });
    fx.burst(hx, hy, hz, { n: 8, color: 0x9fc0ff, speed: 6, up: 1, life: 0.25, grav: 4 });
  } else {
    fx.burst(hx, hy - 0.2, hz, { n: 16, color: 0x8a0e0e, speed: 3.5, up: 2, life: 0.6, grav: 14, dir, spread: 0.9 });
  }
  fx.ring(hx, hy, hz, { color: crit ? 0xffd070 : 0xbfd4ff, size: crit ? 2.4 : 1.5 });
  sfx.hit(HIT_KIND[e.type], crit);
  floatText(crit ? `${d}!` : String(d), e.x, hy + 0.9, e.z, crit ? 'crit' : 'dmg');

  const killed = e.hp <= 0;
  if (killed) killEnemy(e, dir, type);
  return { crit, killed };
}

function killEnemy(e, dir = { x: 0, z: 0 }, type = 'slashA') {
  e.dead = true; e.deadT = 0; e.state = 'dead'; e.atk = null; e.react = null; e.stagger = 0;
  setFlash(e.rig, false);
  if (player.attackTarget === e) player.attackTarget = null;
  const gy = groundY(e.x, e.z);
  if (e.t.humanoid) {
    // os ossos se despedaçam e voam na direção do golpe
    fx.shatter(e.rig.root, new THREE.Vector3(e.x, gy + 0.8, e.z), type === 'heavy' ? 1.5 : 1.1, dir);
    e.shattered = true;
    fx.burst(e.x, gy + 1, e.z, { n: 24, color: e.type === 'lord' ? 0x70ff9a : 0xd8d0b8, speed: 4, life: 0.8, grav: 3 });
    sfx.shatter();
  } else sfx.yelp();
  if (e.type === 'lord') {
    fx.ring(e.x, gy + 0.1, e.z, { color: 0x70ff9a, size: 9, life: 0.6, ground: true });
    fx.burst(e.x, gy + 1.5, e.z, { n: 80, color: 0x70ff9a, speed: 7, life: 1.2, grav: 2 });
  }
  const gold = ri(...e.t.gold);
  player.gold += gold;
  log(`${e.t.name} destruído. +${e.t.xp} XP${gold ? `, +${gold} ouro` : ''}`, 'c-acc');
  if (gold) floatText(`+${gold} ouro`, e.x, gy + 2.7, e.z, 'gold');
  gainXp(e.t.xp);
  if (e.type === 'skeleton' && quest.stage === 1 && ++quest.kills >= 6) { quest.stage = 2; log('Esqueletos suficientes. Volte ao Ancião.', 'c-ok'); }
  if (e.type === 'lord' && quest.stage === 3) { quest.stage = 4; log('O Lorde Esqueleto caiu! Volte ao Ancião.', 'c-ok'); }
  if (rand() < (e.type === 'lord' ? 1 : 0.25)) dropPotion(e.x, e.z);
  updateHud();
}
function dropPotion(x, z) {
  const g = new THREE.Group();
  const flask = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3050 }));
  flask.position.y = 0.18; g.add(flask);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.16, 6), new THREE.MeshLambertMaterial({ color: 0xc8c0a0 }));
  neck.position.y = 0.38; g.add(neck);
  g.position.set(x, groundY(x, z) + 0.2, z); scene.add(g);
  pickups.push({ x, z, mesh: g });
}

const faceDir = dir => { player.rot = Math.atan2(dir.x, dir.z); };
const facing = () => ({ x: Math.sin(player.rot), z: Math.cos(player.rot) });
function dirTo(x, z) { const dx = x - player.x, dz = z - player.z, l = Math.hypot(dx, dz) || 1; return { x: dx / l, z: dz / l }; }

function startAttack(type, dir) {
  if (dir) faceDir(dir);
  player.act = { kind: 'attack', type, t: 0, dur: ATTACKS[type].dur, hitAt: ATTACKS[type].hit, hitDone: false, swung: false };
}
// combo de 3 golpes; cliques durante a parte final do golpe ficam guardados
function requestAttack(dir) {
  const p = player;
  if (p.dead || dialogOpen) return;
  if (p.act) { if (p.act.kind === 'attack' && p.act.type !== 'heavy' && p.act.t > 0.35) p.queued = dir || true; return; }
  if (p.comboTimer <= 0) p.combo = 0;
  startAttack(COMBO[p.combo], dir);
  p.combo = (p.combo + 1) % COMBO.length;
}
function heavyAttack(dir) {
  const p = player;
  if (p.dead || dialogOpen || p.heavyCd > 0 || (p.act && p.act.kind === 'dodge')) return;
  startAttack('heavy', dir); p.heavyCd = HEAVY_CD; p.combo = 0; p.queued = null;
}
function dodge(dir) {
  const p = player;
  if (p.dead || dialogOpen || p.dodgeCd > 0) return;
  if (p.act && p.act.kind === 'attack' && p.act.type === 'heavy' && !p.act.hitDone) return;
  dir = dir || facing(); faceDir(dir);
  p.act = { kind: 'dodge', t: 0, dur: 0.45, dx: dir.x, dz: dir.z };
  p.invuln = 0.4; p.dodgeCd = DODGE_CD; p.moveTarget = null; p.attackTarget = null; p.queued = null;
  sfx.dodge();
  fx.burst(p.x, groundY(p.x, p.z) + 0.1, p.z, { n: 10, color: 0x6a6a7a, speed: 2, up: 0.5, life: 0.5, grav: 1 });
}

// ponto mais próximo do segmento a-b em relação a c
const _seg = new THREE.Vector3(), _cen = new THREE.Vector3();
function closestOnSegment(a, b, c, out) {
  _seg.subVectors(b, a);
  const t = clamp(_cen.subVectors(c, a).dot(_seg) / Math.max(_seg.lengthSq(), 1e-6), 0, 1);
  return out.copy(a).addScaledVector(_seg, t);
}

function resolvePlayerHit(type) {
  const A = COMBAT.attacks[type], p = player, f = facing(), rig = p.rig;
  // posição da lâmina neste instante: os efeitos nascem onde ela encosta
  rig.root.updateMatrixWorld(true);
  const tip = rig.sword.localToWorld(trailA.copy(rig.swordTip)), mid = rig.sword.localToWorld(trailB.copy(rig.swordMid));
  const heavy = type === 'heavy';
  const cx = heavy ? p.x + f.x * A.offset : p.x, cz = heavy ? p.z + f.z * A.offset : p.z;
  const victims = [];
  let crit = false, kills = 0, bossKill = false;
  for (const e of enemies) {
    if (e.dead) continue;
    const rad = e.t.radius || 0;
    if (heavy) { if (Math.hypot(e.x - cx, e.z - cz) > A.radius + rad) continue; }
    else {
      const ex = e.x - p.x, ez = e.z - p.z, de = Math.hypot(ex, ez);
      if (de > A.range + rad || (ex * f.x + ez * f.z) / (de || 1) < A.arc) continue;
    }
    const gy = groundY(e.x, e.z), torso = e.type === 'lord' ? 1.8 : e.type === 'wolf' ? 0.7 : 1.15;
    _cen.set(e.x, gy + torso, e.z);
    const contact = heavy ? new THREE.Vector3(e.x, gy + torso * 0.7, e.z)
      : closestOnSegment(mid, tip, _cen, new THREE.Vector3()).lerp(_cen, 0.45);
    const r = damageEnemy(e, type, dirTo(e.x, e.z), contact);
    victims.push(e); crit = crit || r.crit;
    if (r.killed) { kills++; if (e.type === 'lord') bossKill = true; }
  }
  if (heavy) {
    const gy = groundY(cx, cz);
    fx.ring(cx, gy + 0.08, cz, { color: 0xbfd4ff, size: 5, life: 0.4, ground: true });
    fx.burst(cx, gy + 0.1, cz, { n: 30, color: 0x7a7a88, speed: 5, up: 2.5, life: 0.7, grav: 8 });
    fx.burst(cx, gy + 0.2, cz, { n: 16, color: 0x9fc0ff, speed: 7, up: 3, life: 0.35, grav: 10 });
    sfx.heavyImpact();
    if (!victims.length) addTrauma(COMBAT.shake.heavyMiss);
  }
  if (victims.length) {
    hitstop(bossKill ? 'bossKill' : crit ? 'crit' : kills ? 'kill' : A.category, [p, ...victims]);
    addTrauma(COMBAT.shake[A.category] + (crit ? COMBAT.shake.crit : 0) + (kills ? COMBAT.shake.kill : 0));
  }
}

// ---------------------------------------------------------- golpes dos inimigos
function enemyStrike(e) {
  const t = e.t, dp = Math.hypot(player.x - e.x, player.z - e.z);
  const inFront = ((player.x - e.x) * Math.sin(e.rot) + (player.z - e.z) * Math.cos(e.rot)) / (dp || 1) > 0.2;
  if (e.type === 'lord') {
    const gx = e.x + Math.sin(e.rot) * 1.8, gz = e.z + Math.cos(e.rot) * 1.8;
    fx.ring(gx, groundY(gx, gz) + 0.08, gz, { color: 0x70ff9a, size: 4, life: 0.4, ground: true });
    fx.burst(gx, groundY(gx, gz) + 0.1, gz, { n: 20, color: 0x6a6a7a, speed: 4, up: 2, life: 0.6, grav: 8 });
    sfx.heavyImpact(); if (dp < 8) addTrauma(0.3);
  }
  if (player.dead || dp > t.reach + 0.7 || !inFront) return;
  if (player.invuln > 0) { floatText('esquiva', player.x, groundY(player.x, player.z) + 2.4, player.z, 'info'); return; }
  hurtPlayer(e);
}
function hurtPlayer(e) {
  const d = ri(...e.t.dmg), ET = COMBAT.enemies[e.type], heavy = e.type === 'lord';
  player.hp -= d;
  const dx = player.x - e.x, dz = player.z - e.z, l = Math.hypot(dx, dz) || 1;
  addImpulse(player, { x: dx / l, z: dz / l }, ET.hitForce);
  setReaction(player, heavy ? 'heavy' : 'light');
  player.stun = 0;   // o herói nunca fica preso numa reação: só a pose muda
  hitstop(heavy ? 'playerHurtHeavy' : 'playerHurt', [player, e]);
  feel.hurtFlash = 1; addTrauma(COMBAT.shake[heavy ? 'playerHurtHeavy' : 'playerHurt']);
  const y = groundY(player.x, player.z) + 1.3;
  fx.burst(player.x - dx / l * 0.3, y, player.z - dz / l * 0.3, { n: 12, color: 0xffc070, speed: 5, life: 0.3, grav: 6 });
  sfx.hurt();
  floatText('-' + d, player.x, y + 0.9, player.z, 'hurt');
  if (player.hp <= 0 && !player.dead) {
    player.hp = 0; player.dead = true; player.deadT = 0; player.act = null;
    player.moveTarget = player.attackTarget = null;
    const lost = Math.floor(player.gold * 0.1); player.gold -= lost;
    log(`Você foi morto por: ${e.t.name}.${lost ? ` Perdeu ${lost} de ouro.` : ''}`, 'c-hp');
    $('death').style.display = 'flex';
  }
  updateHud();
}
function drinkPotion() {
  if (player.dead) return;
  if (!player.potions) { log('Você não tem poções.', 'c-dim'); return; }
  if (player.hp >= player.maxHp) { log('Sua vida já está cheia.', 'c-dim'); return; }
  player.potions--; const heal = Math.round(player.maxHp * 0.5);
  player.hp = Math.min(player.maxHp, player.hp + heal);
  floatText('+' + heal, player.x, groundY(player.x, player.z) + 2.4, player.z, 'heal');
  sfx.pickup();
  log(`Você bebe uma poção (+${heal} HP).`, 'c-ok'); updateHud();
}

// =====================================================================
// entrada
// =====================================================================
let started = false, cellSize = 7;
let camYaw = 0, camDist = 12, camPitch = 0.92;
const keys = new Set();
const mouse = { x: innerWidth / 2, y: innerHeight / 2, rdrag: false, lastX: 0 };
let hovered = null;
const GRASS_LEVELS = [1, 0.5, 0.25, 0];

addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
  if (!started) return;
  keys.add(k);
  if (e.repeat) return;
  if (dialogOpen) { if (['f', 'enter', ' '].includes(k)) closeDialog(true); else if (k === 'escape') closeDialog(false); return; }
  if (k === ' ') dodge(player.inDir || mouseDir());
  else if (k === 'r') heavyAttack(mouseDir());
  else if (k === '1') drinkPotion();
  else if (k === 'f') { if (!tryTalk()) log('Não há ninguém por perto.', 'c-dim'); }
  else if (k === 'm') log(toggleMute() ? 'Som desligado.' : 'Som ligado.', 'c-dim');
  else if (k === 't') ascii.material.uniforms.asciiOn.value = 1 - ascii.material.uniforms.asciiOn.value;
  else if (k === ']') ascii.material.uniforms.cell.value = cellSize = Math.min(20, cellSize + 1);
  else if (k === '[') ascii.material.uniforms.cell.value = cellSize = Math.max(4, cellSize - 1);
  else if (k === 'g') {
    const next = GRASS_LEVELS[(GRASS_LEVELS.indexOf(world.grassDensity) + 1) % GRASS_LEVELS.length];
    world.setGrassDensity(next);
    log(`Grama: ${Math.round(next * 100)}%`, 'c-dim');
  }
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());
addEventListener('mousemove', e => {
  if (mouse.rdrag) camYaw -= (e.clientX - mouse.lastX) * 0.008;
  mouse.lastX = e.clientX; mouse.x = e.clientX; mouse.y = e.clientY;
});
addEventListener('mouseup', e => { if (e.button === 1) mouse.rdrag = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('wheel', e => { camDist = clamp(camDist + Math.sign(e.deltaY) * 1.5, 7, 40); }, { passive: true });

const clickRing = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.55, 16).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xf0b450, transparent: true }));
clickRing.visible = false; scene.add(clickRing);

const raycaster = new THREE.Raycaster();
function groundAtMouse() {
  raycaster.setFromCamera(new THREE.Vector2(mouse.x / innerWidth * 2 - 1, -mouse.y / innerHeight * 2 + 1), camera);
  const hit = raycaster.intersectObject(world.terrain)[0];
  return hit ? hit.point : null;
}
function mouseDir() { const p = groundAtMouse(); return p ? dirTo(p.x, p.z) : facing(); }

renderer.domElement.addEventListener('mousedown', e => {
  if (!started) return;
  if (e.button === 1) { e.preventDefault(); mouse.rdrag = true; mouse.lastX = e.clientX; return; }
  if (player.dead) return;
  if (e.button === 2) { heavyAttack(hovered && hovered !== elder ? dirTo(hovered.x, hovered.z) : mouseDir()); return; }
  if (e.button !== 0) return;
  if (dialogOpen) { closeDialog(false); return; }
  if (e.shiftKey) { player.moveTarget = player.attackTarget = null; requestAttack(mouseDir()); return; }
  if (hovered === elder) {
    if (!tryTalk()) { player.moveTarget = { x: elder.x, z: elder.z + 1.4 }; player.attackTarget = null; player.talkPending = true; }
    return;
  }
  if (hovered) {
    player.attackTarget = hovered; player.moveTarget = null; player.talkPending = false;
    if (Math.hypot(hovered.x - player.x, hovered.z - player.z) < 1.9 + (hovered.t.radius || 0)) requestAttack(dirTo(hovered.x, hovered.z));
    return;
  }
  const hit = groundAtMouse();
  if (hit) {
    player.moveTarget = { x: hit.x, z: hit.z }; player.attackTarget = null; player.talkPending = false;
    clickRing.position.set(hit.x, groundY(hit.x, hit.z) + 0.06, hit.z);
    clickRing.visible = true; clickRing.material.opacity = 1;
  }
});

$('intro').addEventListener('click', () => {
  $('intro').style.display = 'none'; document.body.classList.remove('intro'); started = true;
  initAudio();
  log('Bem-vindo ao Reino de Ferro.', 'c-acc');
  log('Fale com o Ancião Aldric (o velho com o "!" amarelo).', 'c-dim');
  updateHud();
});

// =====================================================================
// atualização
// =====================================================================
function faceTo(o, tx, tz, dt, speed = 12) {
  let d = Math.atan2(tx - o.x, tz - o.z) - o.rot; d = Math.atan2(Math.sin(d), Math.cos(d));
  o.rot += d * Math.min(1, dt * speed);
}
const blend = (cur, target, dt, k = 10) => cur + (target - cur) * Math.min(1, dt * k);

function updatePlayer(dt, time) {
  const p = player, rig = p.rig;
  if (p.dead) {
    p.deadT += dt;
    rig.root.rotation.x = -Math.min(Math.PI / 2, p.deadT * 3);
    if (p.deadT > 3) {
      p.dead = false; p.hp = p.maxHp; p.x = SPAWN.x; p.z = SPAWN.z; rig.root.rotation.x = 0;
      p.kvx = p.kvz = 0; p.react = null;
      $('death').style.display = 'none';
      for (const e of enemies) if (!e.dead) e.state = 'return';
      updateHud();
    }
    rig.root.position.set(p.x, groundY(p.x, p.z), p.z);
    return;
  }
  p.heavyCd = Math.max(0, p.heavyCd - dt); p.dodgeCd = Math.max(0, p.dodgeCd - dt);
  p.invuln = Math.max(0, p.invuln - dt); p.comboTimer = Math.max(0, p.comboTimer - dt);
  if (p.react && (p.react.t += dt / p.react.dur) >= 1) p.react = null;
  if (Math.abs(p.kvx) + Math.abs(p.kvz) > 0.02) {
    moveEntity(p, p.kvx * dt, p.kvz * dt, 0.35);
    const k = Math.exp(-COMBAT.knockback.decay * dt); p.kvx *= k; p.kvz *= k;
  }

  let moving = false;
  const speed = 5.2;
  let ix = 0, iz = 0;
  if (!dialogOpen) {
    if (keys.has('w') || keys.has('arrowup')) iz -= 1;
    if (keys.has('s') || keys.has('arrowdown')) iz += 1;
    if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
    if (keys.has('d') || keys.has('arrowright')) ix += 1;
  }
  p.inDir = null;
  if (ix || iz) {
    const fx_ = -Math.sin(camYaw), fz_ = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    const dx = rx * ix - fx_ * iz, dz = rz * ix - fz_ * iz, l = Math.hypot(dx, dz);
    p.inDir = { x: dx / l, z: dz / l };
  }

  const act = p.act;
  if (act && act.kind === 'dodge') {
    act.t += dt / act.dur;
    const sp = 9.5 * (1 - act.t * 0.7);
    moveEntity(p, act.dx * sp * dt, act.dz * sp * dt, 0.35);
    if (act.t >= 1) p.act = null;
  } else if (act && act.kind === 'attack') {
    act.t += dt / act.dur;
    // avanço do corpo no golpe, a não ser que já esteja colado no inimigo
    const lunge = act.type === 'heavy' ? 2.0 : act.type === 'finisher' ? 1.1 : 0.6, f = facing();
    const blocked = enemies.some(e => !e.dead && Math.hypot(e.x - p.x, e.z - p.z) < 1.3 + (e.t.radius || 0)
      && ((e.x - p.x) * f.x + (e.z - p.z) * f.z) > 0);
    if (!blocked && act.t > act.hitAt - 0.22 && act.t < act.hitAt) {
      const v = lunge / (0.22 * act.dur);
      moveEntity(p, f.x * v * dt, f.z * v * dt, 0.35);
    }
    if (!act.swung && act.t > act.hitAt - 0.15) { act.swung = true; sfx.swing(act.type === 'heavy'); }
    if (!act.hitDone && act.t >= act.hitAt) { act.hitDone = true; resolvePlayerHit(act.type); }
    if (act.t > act.hitAt - 0.25 && act.t < act.hitAt + 0.18) {
      fx.trail(rig.sword.localToWorld(trailA.copy(rig.swordTip)), rig.sword.localToWorld(trailB.copy(rig.swordMid)), act.type === 'heavy' ? 0xd8e4ff : 0x8fb0ff);
    }
    if (act.t >= 1) {
      p.act = null; p.comboTimer = 0.55;
      if (p.queued) { const q = p.queued; p.queued = null; requestAttack(q === true ? null : q); }
    }
  } else if (p.inDir) {
    p.moveTarget = p.attackTarget = null; p.talkPending = false;
    moving = moveEntity(p, p.inDir.x * speed * dt, p.inDir.z * speed * dt, 0.35);
    faceTo(p, p.x + p.inDir.x, p.z + p.inDir.z, dt);
  } else if (p.attackTarget) {
    const e = p.attackTarget, d = Math.hypot(e.x - p.x, e.z - p.z);
    if (e.dead) p.attackTarget = null;
    else if (d > 1.7 + (e.t.radius || 0)) {
      moving = moveEntity(p, (e.x - p.x) / d * speed * dt, (e.z - p.z) / d * speed * dt, 0.35);
      faceTo(p, e.x, e.z, dt);
    } else requestAttack(dirTo(e.x, e.z));
  } else if (p.moveTarget) {
    const t = p.moveTarget, d = Math.hypot(t.x - p.x, t.z - p.z);
    if (d < 0.25 || (p.talkPending && tryTalk())) { p.moveTarget = null; p.talkPending = false; }
    else {
      const step = Math.min(d, speed * dt);
      moving = moveEntity(p, (t.x - p.x) / d * step, (t.z - p.z) / d * step, 0.35);
      faceTo(p, t.x, t.z, dt);
      if (!moving) p.moveTarget = null;
    }
  }
  p.moveAmt = blend(p.moveAmt, moving ? 1 : 0, dt);
  if (moving) p.phase += dt * 9.5;
  for (let i = pickups.length - 1; i >= 0; i--) {
    const k = pickups[i];
    if (Math.hypot(k.x - p.x, k.z - p.z) < 1.0) {
      scene.remove(k.mesh); pickups.splice(i, 1); p.potions++;
      sfx.pickup(); log('Você pegou uma poção de cura.', 'c-ok'); updateHud();
    }
  }
  rig.root.position.set(p.x, groundY(p.x, p.z), p.z);
  rig.root.rotation.y = p.rot;
  const a = p.act;
  poseHumanoid(rig, { phase: p.phase, move: p.moveAmt, time,
    react: p.react ? p.react.t : -1, reactKind: p.react?.kind, reactAmount: p.react?.amount, reactSide: p.react?.side,
    attack: a && a.kind === 'attack' ? Math.min(1, a.t) : -1, attackType: a ? a.type : undefined,
    dodge: a && a.kind === 'dodge' ? Math.min(1, a.t) : -1 });
  animateCape(rig, a && a.kind === 'dodge' ? 1 : p.moveAmt, time);
}

// parâmetros de reação/cambaleio para as funções de pose
function reactPose(o) {
  return { react: o.react ? Math.min(1, o.react.t) : -1, reactKind: o.react?.kind, reactAmount: o.react?.amount,
    reactSide: o.react?.side, stagger: o.stagger > 0 ? 1 - o.stagger / o.staggerMax : -1 };
}

function updateEnemy(e, dt, time) {
  const t = e.t;
  if (e.dead) {
    e.deadT += dt;
    if (!e.shattered) {   // lobo: tomba de lado e afunda
      const root = e.rig.root;
      root.rotation.z = Math.min(Math.PI / 2, e.deadT * 5);
      root.position.y = groundY(e.x, e.z) - Math.max(0, e.deadT - 2) * 0.4;
      root.visible = e.deadT < 4.5;
    }
    if (e.deadT > t.respawn) {
      if (e.shattered) { scene.remove(e.rig.root); e.rig = t.make(); scene.add(e.rig.root); e.shattered = false; }
      Object.assign(e, { dead: false, hp: t.hp, x: e.sx, z: e.sz, state: 'idle', react: null, stun: 0, stagger: 0,
        kvx: 0, kvz: 0, atk: null, poise: COMBAT.enemies[e.type].poise });
      e.rig.root.rotation.set(0, 0, 0); e.rig.root.visible = true;
    }
    return;
  }
  const root = e.rig.root, rad = t.radius || 0.4, ET = COMBAT.enemies[e.type];
  e.cd = Math.max(0, e.cd - dt); e.stun = Math.max(0, e.stun - dt); e.stagger = Math.max(0, e.stagger - dt);
  if (e.react && (e.react.t += dt / e.react.dur) >= 1) e.react = null;
  if ((e.poiseT += dt) > COMBAT.poiseRegenDelay) e.poise = Math.min(ET.poise, e.poise + ET.poiseRegen * dt);
  if (e.flash > 0) { e.flash -= dt; if (e.flash <= 0) setFlash(e.rig, false); }
  if (Math.abs(e.kvx) + Math.abs(e.kvz) > 0.02) {
    moveEntity(e, e.kvx * dt, e.kvz * dt, rad);
    const k = Math.exp(-COMBAT.knockback.decay * dt); e.kvx *= k; e.kvz *= k;
  }
  const dp = Math.hypot(player.x - e.x, player.z - e.z), dh = Math.hypot(e.sx - e.x, e.sz - e.z);
  let moving = false;
  const sp = t.speed;
  if (e.state === 'idle' && !player.dead && dp < t.aggro) e.state = 'chase';
  if (e.state === 'chase' && (player.dead || dp > t.aggro * 2.2 || dh > 28)) e.state = 'return';
  if (e.atk) {
    e.atk.t += dt / t.atkDur;
    if (!e.atk.done && e.atk.t >= t.atkHit) { e.atk.done = true; enemyStrike(e); }
    if (e.atk && e.atk.t < t.atkHit) faceTo(e, player.x, player.z, dt, 4);   // mira devagar durante a preparação
    if (e.atk && e.atk.t >= 1) e.atk = null;
  } else if (e.stun > 0 || e.stagger > 0) {
    // atordoado pela reação ou com a postura quebrada: não age
  } else if (e.state === 'chase') {
    if (dp > t.reach) moving = moveEntity(e, (player.x - e.x) / dp * sp * dt, (player.z - e.z) / dp * sp * dt, rad);
    else if (e.cd <= 0) { e.cd = t.cd; e.atk = { t: 0, done: false }; }
    faceTo(e, player.x, player.z, dt, 8);
  } else if (e.state === 'return') {
    if (dh < 0.6) e.state = 'idle';
    else {
      moving = moveEntity(e, (e.sx - e.x) / dh * sp * dt, (e.sz - e.z) / dh * sp * dt, rad);
      faceTo(e, e.sx, e.sz, dt);
      if (!moving) { e.x = e.sx; e.z = e.sz; }
    }
    e.hp = Math.min(t.hp, e.hp + t.hp * 0.2 * dt);
  } else {
    e.wanderT -= dt;
    if (e.wanderT <= 0) { e.wander = { x: e.sx + rr(-5, 5), z: e.sz + rr(-5, 5) }; e.wanderT = rr(3, 7); }
    if (e.wander) {
      const d = Math.hypot(e.wander.x - e.x, e.wander.z - e.z);
      if (d > 0.3) {
        moving = moveEntity(e, (e.wander.x - e.x) / d * sp * 0.35 * dt, (e.wander.z - e.z) / d * sp * 0.35 * dt, rad);
        faceTo(e, e.wander.x, e.wander.z, dt, 4);
      }
      if (!moving) e.wander = null;
    }
  }
  e.moveAmt = blend(e.moveAmt, moving ? 1 : 0, dt);
  if (moving) e.phase += dt * sp * (t.humanoid ? 2.4 : 2.6) * (e.state === 'idle' ? 0.5 : 1);
  root.position.set(e.x, groundY(e.x, e.z), e.z);
  root.rotation.y = e.rot;
  const attack = e.atk ? Math.min(1, e.atk.t) : -1;
  if (t.humanoid) {
    poseHumanoid(e.rig, { phase: e.phase, move: e.moveAmt, attack, time: time + e.sx, jitter: 0.04, ...reactPose(e) });
    animateCape(e.rig, e.moveAmt, time);
  } else poseWolf(e.rig, { phase: e.phase, move: e.moveAmt, attack, time: time + e.sx, ...reactPose(e) });
}

function separate() {
  for (let i = 0; i < enemies.length; i++) for (let j = i + 1; j < enemies.length; j++) {
    const a = enemies[i], b = enemies[j]; if (a.dead || b.dead) continue;
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), m = 0.9;
    if (d > 0 && d < m) { const push = (m - d) / 2 / d; moveEntity(a, -dx * push, -dz * push, 0.3); moveEntity(b, dx * push, dz * push, 0.3); }
  }
}

function updateHover() {
  hovered = null; let best = 1e9;
  const r = 40 * 12 / camDist;
  for (const o of [elder, ...enemies]) {
    if (o.dead) continue;
    const s = toScreen(o.x, groundY(o.x, o.z) + 1, o.z), d = Math.hypot(s.x - mouse.x, s.y - mouse.y);
    if (s.vis && d < r && d < best) { best = d; hovered = o; }
  }
  const h = $('hover');
  if (hovered && started) {
    h.style.display = 'block'; h.style.left = mouse.x + 14 + 'px'; h.style.top = mouse.y + 10 + 'px';
    h.textContent = hovered === elder ? `${elder.name} — clique para falar` : `${hovered.t.name} — clique para atacar`;
    renderer.domElement.style.cursor = 'pointer';
  } else { h.style.display = 'none'; renderer.domElement.style.cursor = 'crosshair'; }
}

function updateBars() {
  for (const e of enemies) {
    const show = started && !e.dead && (e.hp < e.t.hp || e.type === 'lord' || e === hovered);
    if (!show) { if (e.bar) e.bar.style.display = 'none'; continue; }
    if (!e.bar) { e.bar = document.createElement('div'); e.bar.className = 'ebar'; document.body.appendChild(e.bar); }
    const s = toScreen(e.x, groundY(e.x, e.z) + (e.t.barH || 2.3), e.z);
    if (!s.vis) { e.bar.style.display = 'none'; continue; }
    e.bar.style.display = 'block'; e.bar.style.left = s.x + 'px'; e.bar.style.top = s.y + 'px';
    e.bar.textContent = (e.type === 'lord' ? e.t.name + '\n' : '') + '[' + bar(e.hp, e.t.hp, 10) + ']';
  }
}

const clock = new THREE.Clock();
const camTarget = new THREE.Vector3(player.x, 0, player.z);
let hudTimer = 0, introBlend = 0, gameTime = 0;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), introPos = new THREE.Vector3(), introLook = new THREE.Vector3();

function frame() {
  requestAnimationFrame(frame);
  const realDt = Math.min(clock.getDelta(), 0.05);
  // hitstop congela o jogo; câmera lenta (morte do chefe) desacelera
  let dt = realDt;
  feel.globalCd = Math.max(0, feel.globalCd - realDt);
  if (feel.global > 0) { feel.global -= realDt; dt = 0; }
  else if (feel.slowmo > 0) { feel.slowmo -= realDt; dt *= COMBAT.hitstop.slowmoScale; }
  gameTime += dt;
  const time = gameTime;

  if (started) {
    if (keys.has('q')) camYaw += dt * 1.8;
    if (keys.has('e')) camYaw -= dt * 1.8;
    // hitstop local: quem participou do impacto fica parado por alguns centésimos
    const localDt = o => { const d = o.freeze > 0 ? 0 : dt; o.freeze = Math.max(0, o.freeze - realDt); return d; };
    updatePlayer(localDt(player), time);
    for (const e of enemies) {
      const far = Math.hypot(e.x - player.x, e.z - player.z) > 55;
      e.rig.root.visible = !far && (!e.dead || e.deadT < 4);
      updateEnemy(e, localDt(e), time);
    }
    separate();
    hudTimer += realDt; if (hudTimer > 0.1) { hudTimer = 0; updateHud(); }
    if (!player.dead && player.hp < player.maxHp && !enemies.some(e => e.state === 'chase')) player.hp = Math.min(player.maxHp, player.hp + dt * 1.5);
  } else {
    poseKneel(player.rig, time);
    player.rig.root.position.set(player.x, groundY(player.x, player.z), player.z);
    player.rig.root.rotation.y = player.rot;
  }
  introBlend = started ? Math.min(1, introBlend + realDt / 2.2) : 0;
  poseElder(elder.rig, time);
  elder.rig.marker.visible = [0, 2, 4].includes(quest.stage);
  for (const k of pickups) { k.mesh.rotation.y = time * 2; k.mesh.position.y = groundY(k.x, k.z) + 0.25 + Math.sin(time * 3) * 0.08; }
  if (clickRing.visible) { clickRing.material.opacity -= realDt * 1.5; if (clickRing.material.opacity <= 0) clickRing.visible = false; }

  // câmera
  camTarget.lerp(tmpV.set(player.x, groundY(player.x, player.z), player.z), 1 - Math.exp(-realDt * 8));
  const cd = camDist * Math.cos(camPitch);
  camPos.set(camTarget.x + Math.sin(camYaw) * cd, camTarget.y + camDist * Math.sin(camPitch), camTarget.z + Math.cos(camYaw) * cd);
  camLook.set(camTarget.x, camTarget.y + 1, camTarget.z);
  if (introBlend < 1) {
    // plano de cinema: câmera baixa à frente do cavaleiro ajoelhado, céu ao fundo
    const ox = Math.sin(INTRO_ROT), oz = Math.cos(INTRO_ROT), gy = groundY(SPAWN.x, SPAWN.z);
    const sway = Math.sin(time * 0.15) * 0.25;
    introPos.set(SPAWN.x + ox * 3.6 + oz * (0.7 + sway), gy + 0.35, SPAWN.z + oz * 3.6 - ox * (0.7 + sway));
    introLook.set(SPAWN.x - ox * 0.5 - oz * 0.9, gy + 2.1, SPAWN.z - oz * 0.5 + ox * 0.9);
    const t = introBlend * introBlend * (3 - 2 * introBlend);
    camPos.lerpVectors(introPos, camPos, t);
    camLook.lerpVectors(introLook, camLook, t);
  }
  camera.position.copy(camPos);
  camera.lookAt(camLook);
  // tremor: deslocamento proporcional ao quadrado do "trauma"
  if (feel.trauma > 0) {
    const k = feel.trauma * feel.trauma * 0.32 * camDist / 12, T = performance.now() / 1000 * 32;
    camera.position.x += (Math.sin(T * 1.3) + Math.sin(T * 2.9)) * 0.5 * k;
    camera.position.y += (Math.sin(T * 1.7 + 1) + Math.sin(T * 3.3)) * 0.5 * k;
    camera.position.z += (Math.sin(T * 1.1 + 2) + Math.sin(T * 2.3)) * 0.5 * k;
    feel.trauma = Math.max(0, feel.trauma - realDt * 1.6);
  }
  $('hurt').style.opacity = String(feel.hurtFlash);
  feel.hurtFlash = Math.max(0, feel.hurtFlash - realDt * 2.5);

  world.update(dt, time, camTarget, player);
  fx.update(dt);

  // recorte: posição do herói na tela (origem embaixo à esquerda, como gl_FragCoord)
  tmpV.set(player.x, groundY(player.x, player.z) + 1.0, player.z).project(camera);
  cutout.center.value.set((tmpV.x + 1) / 2 * innerWidth, (tmpV.y + 1) / 2 * innerHeight);
  cutout.depth.value = tmpV.z * 0.5 + 0.5;
  cutout.radius.value = introBlend < 1 ? 0 : 1300 / camDist;

  // render: cena -> textura -> ASCII
  renderer.setRenderTarget(sceneRT);
  renderer.render(scene, camera);
  bloom.render(renderer, sceneRT.texture);
  ascii.material.uniforms.time.value = time;
  renderer.render(ascii.scene, ascii.camera);

  updateHover();
  updateBars();
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i]; f.t += realDt; f.pos.y += realDt * 1.2;
    const s = toScreen(f.pos.x, f.pos.y, f.pos.z);
    f.el.style.left = s.x + 'px'; f.el.style.top = s.y + 'px'; f.el.style.opacity = String(1 - Math.max(0, f.t - 0.6) / 0.5);
    if (f.t > 1.1) { f.el.remove(); floats.splice(i, 1); }
  }
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  sceneRT.setSize(innerWidth, innerHeight);
  ascii.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});

// ganchos para testes automatizados
window.__game = { player, enemies, quest, world, feel, COMBAT, requestAttack, heavyAttack, dodge, dirTo, skipIntro: () => { introBlend = 1; }, setCam: (y, d, p) => { camYaw = y; camDist = d; if (p) camPitch = p; } };
updateHud();
frame();

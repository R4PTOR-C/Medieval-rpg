// Loop principal: render (cena -> textura -> ASCII), entrada, combate, HUD.
import * as THREE from 'three';
import { rand, rr, ri, clamp } from './util.js';
import { RUINS, FIRE, SPAWN, ELDER, heightAt, groundY, canStand, moveEntity, colliders } from './terrain.js';
import { buildWorld } from './world.js';
import { cutout } from './geo.js';
import { createAscii } from './ascii.js';
import { makeKnight, makeSkeleton, makeWolf, makeElder, poseHumanoid, poseWolf, poseElder, poseKneel, animateCape } from './models.js';
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

// =====================================================================
// entidades
// =====================================================================
const player = {
  name: 'Sir Roland', x: SPAWN.x, z: SPAWN.z, rot: 0.45, hp: 100, maxHp: 100, level: 1, xp: 0,
  gold: 0, potions: 3, dmg: [10, 16], atkCd: 0, swing: 0, phase: 0, moveAmt: 0,
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
  skeleton: { name: 'Esqueleto', hp: 42, dmg: [5, 9], speed: 2.4, xp: 26, gold: [2, 8], aggro: 10, reach: 1.35, cd: 1.3, respawn: 30, make: () => makeSkeleton(), humanoid: true },
  wolf: { name: 'Lobo', hp: 30, dmg: [4, 7], speed: 4.3, xp: 18, gold: [0, 2], aggro: 12, reach: 1.45, cd: 1.0, respawn: 30, make: makeWolf },
  lord: { name: 'Lorde Esqueleto', hp: 260, dmg: [13, 20], speed: 2.7, xp: 220, gold: [60, 100], aggro: 11, reach: 2.1, cd: 1.6, respawn: 120, make: () => makeSkeleton(true), humanoid: true, radius: 0.7, barH: 3.8 },
};
const enemies = [];
function spawnEnemy(type, x, z) {
  for (let i = 0; i < 40 && !canStand(x, z, 0.5); i++) { x += rr(-2, 2); z += rr(-2, 2); }
  const t = TYPES[type];
  const e = { type, t, x, z, sx: x, sz: z, rot: rr(0, 6), hp: t.hp, state: 'idle', cd: 0, swing: 0, phase: 0, moveAmt: 0,
    wander: null, wanderT: rr(1, 4), dead: false, deadT: 0, hit: 0, rig: t.make(), bar: null };
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
const bar = (v, max, n) => { const f = Math.round(clamp(v / max, 0, 1) * n); return '#'.repeat(f) + '-'.repeat(n - f); };
function updateHud() {
  const p = player;
  $('stats').innerHTML =
    `<span class="c-acc">${p.name.toUpperCase()}</span>  ·  NV ${p.level}\n` +
    `HP <span class="c-hp">[${bar(p.hp, p.maxHp, 18)}]</span> ${Math.ceil(p.hp)}/${p.maxHp}\n` +
    `XP <span class="c-xp">[${bar(p.xp, xpNeeded(), 18)}]</span> ${p.xp}/${xpNeeded()}\n` +
    `Ouro <span class="c-acc">${p.gold}</span>   Poções <span class="c-hp">${p.potions}</span>   Dano ${p.dmg[0]}-${p.dmg[1]}`;
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
function floatText(text, x, y, z, color = '#fff', size = 14) {
  const el = document.createElement('div'); el.className = 'float'; el.textContent = text;
  el.style.color = color; el.style.fontSize = size + 'px';
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
// combate
// =====================================================================
function gainXp(n) {
  player.xp += n;
  while (player.xp >= xpNeeded()) {
    player.xp -= xpNeeded(); player.level++;
    player.maxHp += 15; player.hp = player.maxHp; player.dmg[0] += 3; player.dmg[1] += 4;
    floatText('NÍVEL ' + player.level + '!', player.x, groundY(player.x, player.z) + 2.8, player.z, '#8fd27a', 20);
    log(`*** Você alcançou o nível ${player.level}! ***`, 'c-ok');
  }
}
function damageEnemy(e) {
  let d = ri(player.dmg[0], player.dmg[1]);
  const crit = rand() < 0.12; if (crit) d *= 2;
  e.hp -= d; e.hit = 0.15;
  if (e.state === 'idle' || e.state === 'return') e.state = 'chase';
  floatText(crit ? `CRÍTICO ${d}` : String(d), e.x, groundY(e.x, e.z) + 2.1, e.z, crit ? '#f0b450' : '#ffffff', crit ? 18 : 14);
  if (e.hp <= 0) killEnemy(e);
}
function killEnemy(e) {
  e.dead = true; e.deadT = 0; e.state = 'dead';
  if (player.attackTarget === e) player.attackTarget = null;
  const gold = ri(...e.t.gold);
  player.gold += gold;
  log(`${e.t.name} destruído. +${e.t.xp} XP${gold ? `, +${gold} ouro` : ''}`, 'c-acc');
  if (gold) floatText(`+${gold} ouro`, e.x, groundY(e.x, e.z) + 2.7, e.z, '#f0b450');
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
function playerAttack(single) {
  if (player.atkCd > 0 || player.dead) return;
  player.atkCd = 0.7; player.swing = 1;
  // o dano acontece no meio do golpe, quando a espada desce
  setTimeout(() => {
    if (player.dead) return;
    if (single) { if (!single.dead && Math.hypot(single.x - player.x, single.z - player.z) < 2.6 + (single.t.radius || 0)) damageEnemy(single); return; }
    const fx = Math.sin(player.rot), fz = Math.cos(player.rot);
    for (const e of enemies) {
      if (e.dead) continue;
      const dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz);
      if (d < 2.3 + (e.t.radius || 0) && (dx * fx + dz * fz) / (d || 1) > 0.35) damageEnemy(e);
    }
  }, 200);
}
function hurtPlayer(e) {
  const d = ri(...e.t.dmg);
  player.hp -= d;
  floatText('-' + d, player.x, groundY(player.x, player.z) + 2.2, player.z, '#e05a4a', 15);
  if (player.hp <= 0 && !player.dead) {
    player.hp = 0; player.dead = true; player.deadT = 0;
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
  floatText('+' + heal, player.x, groundY(player.x, player.z) + 2.4, player.z, '#8fd27a', 16);
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
  if (k === ' ') playerAttack(null);
  else if (k === '1') drinkPotion();
  else if (k === 'f') { if (!tryTalk()) log('Não há ninguém por perto.', 'c-dim'); }
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
addEventListener('mouseup', e => { if (e.button === 2) mouse.rdrag = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('wheel', e => { camDist = clamp(camDist + Math.sign(e.deltaY) * 1.5, 7, 40); }, { passive: true });

const clickRing = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.55, 16).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xf0b450, transparent: true }));
clickRing.visible = false; scene.add(clickRing);

const raycaster = new THREE.Raycaster();
renderer.domElement.addEventListener('mousedown', e => {
  if (!started) return;
  if (e.button === 2) { mouse.rdrag = true; mouse.lastX = e.clientX; return; }
  if (e.button !== 0 || player.dead) return;
  if (dialogOpen) { closeDialog(false); return; }
  if (hovered === elder) {
    if (!tryTalk()) { player.moveTarget = { x: elder.x, z: elder.z + 1.4 }; player.attackTarget = null; player.talkPending = true; }
    return;
  }
  if (hovered) { player.attackTarget = hovered; player.moveTarget = null; player.talkPending = false; return; }
  raycaster.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1), camera);
  const hit = raycaster.intersectObject(world.terrain)[0];
  if (hit) {
    player.moveTarget = { x: hit.point.x, z: hit.point.z }; player.attackTarget = null; player.talkPending = false;
    clickRing.position.set(hit.point.x, groundY(hit.point.x, hit.point.z) + 0.06, hit.point.z);
    clickRing.visible = true; clickRing.material.opacity = 1;
  }
});

$('intro').addEventListener('click', () => {
  $('intro').style.display = 'none'; document.body.classList.remove('intro'); started = true;
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
      $('death').style.display = 'none';
      for (const e of enemies) if (!e.dead) e.state = 'return';
      updateHud();
    }
    rig.root.position.set(p.x, groundY(p.x, p.z), p.z);
    return;
  }
  p.atkCd = Math.max(0, p.atkCd - dt);
  p.swing = Math.max(0, p.swing - dt * 1.9);
  let moving = false;
  const speed = 5.2;
  let ix = 0, iz = 0;
  if (!dialogOpen) {
    if (keys.has('w') || keys.has('arrowup')) iz -= 1;
    if (keys.has('s') || keys.has('arrowdown')) iz += 1;
    if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
    if (keys.has('d') || keys.has('arrowright')) ix += 1;
  }
  if (ix || iz) {
    p.moveTarget = p.attackTarget = null; p.talkPending = false;
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let dx = rx * ix - fx * iz, dz = rz * ix - fz * iz; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    moving = moveEntity(p, dx * speed * dt, dz * speed * dt, 0.35);
    faceTo(p, p.x + dx, p.z + dz, dt);
  } else if (p.attackTarget) {
    const e = p.attackTarget, d = Math.hypot(e.x - p.x, e.z - p.z);
    if (e.dead) p.attackTarget = null;
    else if (d > 1.6 + (e.t.radius || 0)) {
      moving = moveEntity(p, (e.x - p.x) / d * speed * dt, (e.z - p.z) / d * speed * dt, 0.35);
      faceTo(p, e.x, e.z, dt);
    } else { faceTo(p, e.x, e.z, dt, 20); playerAttack(e); }
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
      log('Você pegou uma poção de cura.', 'c-ok'); updateHud();
    }
  }
  rig.root.position.set(p.x, groundY(p.x, p.z), p.z);
  rig.root.rotation.y = p.rot;
  poseHumanoid(rig, { phase: p.phase, move: p.moveAmt, attack: p.swing > 0 ? 1 - p.swing : -1, time });
  animateCape(rig, p.moveAmt, time);
}

function updateEnemy(e, dt, time) {
  const t = e.t, root = e.rig.root;
  if (e.dead) {
    e.deadT += dt;
    root.rotation.x = -Math.min(Math.PI / 2, e.deadT * 4);
    root.position.y = groundY(e.x, e.z) - Math.max(0, e.deadT - 1.5) * 0.6;
    root.visible = e.deadT < 4;
    if (e.deadT > t.respawn) {
      Object.assign(e, { dead: false, hp: t.hp, x: e.sx, z: e.sz, state: 'idle' });
      root.rotation.x = 0; root.visible = true;
    }
    return;
  }
  e.cd = Math.max(0, e.cd - dt); e.swing = Math.max(0, e.swing - dt * 1.6); e.hit = Math.max(0, e.hit - dt);
  const dp = Math.hypot(player.x - e.x, player.z - e.z), dh = Math.hypot(e.sx - e.x, e.sz - e.z);
  let moving = false;
  const sp = t.speed, rad = t.radius || 0.4;
  if (e.state === 'idle' && !player.dead && dp < t.aggro) e.state = 'chase';
  if (e.state === 'chase' && (player.dead || dp > t.aggro * 2.2 || dh > 28)) e.state = 'return';
  if (e.state === 'chase') {
    if (dp > t.reach) moving = moveEntity(e, (player.x - e.x) / dp * sp * dt, (player.z - e.z) / dp * sp * dt, rad);
    else if (e.cd <= 0) {
      e.cd = t.cd; e.swing = 1;
      setTimeout(() => { if (!e.dead && !player.dead && Math.hypot(player.x - e.x, player.z - e.z) < t.reach + 0.6) hurtPlayer(e); }, 300);
    }
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
  root.position.set(e.x, groundY(e.x, e.z) + (e.hit > 0 ? 0.1 : 0), e.z);
  root.rotation.y = e.rot;
  const attack = e.swing > 0 ? 1 - e.swing : -1;
  if (t.humanoid) {
    poseHumanoid(e.rig, { phase: e.phase, move: e.moveAmt, attack, time: time + e.sx, jitter: 0.04 });
    animateCape(e.rig, e.moveAmt, time);
  } else poseWolf(e.rig, { phase: e.phase, move: e.moveAmt, attack, time: time + e.sx });
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
let hudTimer = 0, introBlend = 0;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), introPos = new THREE.Vector3(), introLook = new THREE.Vector3();

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05), time = clock.elapsedTime;

  if (started) {
    if (keys.has('q')) camYaw += dt * 1.8;
    if (keys.has('e')) camYaw -= dt * 1.8;
    updatePlayer(dt, time);
    for (const e of enemies) {
      const far = Math.hypot(e.x - player.x, e.z - player.z) > 55;
      e.rig.root.visible = !far && (!e.dead || e.deadT < 4);
      updateEnemy(e, dt, time);
    }
    separate();
    hudTimer += dt; if (hudTimer > 0.25) { hudTimer = 0; updateHud(); }
    if (!player.dead && player.hp < player.maxHp && !enemies.some(e => e.state === 'chase')) player.hp = Math.min(player.maxHp, player.hp + dt * 1.5);
  } else {
    poseKneel(player.rig, time);
    player.rig.root.position.set(player.x, groundY(player.x, player.z), player.z);
    player.rig.root.rotation.y = player.rot;
  }
  introBlend = started ? Math.min(1, introBlend + dt / 2.2) : 0;
  poseElder(elder.rig, time);
  elder.rig.marker.visible = [0, 2, 4].includes(quest.stage);
  for (const k of pickups) { k.mesh.rotation.y = time * 2; k.mesh.position.y = groundY(k.x, k.z) + 0.25 + Math.sin(time * 3) * 0.08; }
  if (clickRing.visible) { clickRing.material.opacity -= dt * 1.5; if (clickRing.material.opacity <= 0) clickRing.visible = false; }

  // câmera
  camTarget.lerp(tmpV.set(player.x, groundY(player.x, player.z), player.z), 1 - Math.exp(-dt * 8));
  const cd = camDist * Math.cos(camPitch);
  camPos.set(camTarget.x + Math.sin(camYaw) * cd, camTarget.y + camDist * Math.sin(camPitch), camTarget.z + Math.cos(camYaw) * cd);
  camLook.set(camTarget.x, camTarget.y + 1, camTarget.z);
  if (introBlend < 1) {
    // plano de cinema: câmera baixa à frente do cavaleiro ajoelhado, céu ao fundo
    const fx = Math.sin(INTRO_ROT), fz = Math.cos(INTRO_ROT), gy = groundY(SPAWN.x, SPAWN.z);
    const sway = Math.sin(time * 0.15) * 0.25;
    introPos.set(SPAWN.x + fx * 3.6 + fz * (0.7 + sway), gy + 0.35, SPAWN.z + fz * 3.6 - fx * (0.7 + sway));
    introLook.set(SPAWN.x - fx * 0.5 - fz * 0.9, gy + 2.1, SPAWN.z - fz * 0.5 + fx * 0.9);
    const t = introBlend * introBlend * (3 - 2 * introBlend);
    camPos.lerpVectors(introPos, camPos, t);
    camLook.lerpVectors(introLook, camLook, t);
  }
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  world.update(dt, time, camTarget, player);

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
    const f = floats[i]; f.t += dt; f.pos.y += dt * 1.2;
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
window.__game = { player, enemies, quest, world, skipIntro: () => { introBlend = 1; }, setCam: (y, d, p) => { camYaw = y; camDist = d; if (p) camPitch = p; } };
updateHud();
frame();

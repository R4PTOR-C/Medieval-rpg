// Parâmetros do "game feel" do combate. Tudo que regula impacto, reação,
// empurrão e postura fica aqui, para ajustar sem caçar números no código.
// Tempos em segundos; forças em unidades/segundo.

export const COMBAT = {
  // golpes do herói. category: 'light' | 'heavy' (define hitstop, reação e tremor)
  attacks: {
    slashA:   { category: 'light', mul: 1.0, range: 2.4, arc: 0.15, force: 2.2, poiseDmg: 10 },
    slashB:   { category: 'light', mul: 1.0, range: 2.4, arc: 0.15, force: 2.2, poiseDmg: 10 },
    finisher: { category: 'heavy', mul: 1.7, range: 2.6, arc: 0.45, force: 6.5, poiseDmg: 30 },
    // golpe pesado em área: círculo de raio `radius` a `offset` metros à frente
    heavy:    { category: 'heavy', mul: 2.6, radius: 2.0, offset: 1.4, force: 9.0, poiseDmg: 60 },
  },

  crit: { chance: 0.12, heavyChance: 0.22, mul: 2, forceMul: 1.3, poiseMul: 1.5 },

  // hitstop: `local` congela só quem bate e quem apanha; `global` congela o
  // mundo inteiro (reservado a impactos fortes). Vários alvos no mesmo golpe
  // geram um único hitstop.
  hitstop: {
    light:      { local: 0.055, global: 0 },
    heavy:      { local: 0.10,  global: 0.035 },
    crit:       { local: 0.12,  global: 0.05 },
    kill:       { local: 0.08,  global: 0.03 },
    bossKill:   { local: 0.30,  global: 0.25, uncapped: true, slowmo: 1.2 },
    playerHurt: { local: 0.06,  global: 0 },
    playerHurtHeavy: { local: 0.10, global: 0.05 },
    maxGlobal: 0.12,        // teto do congelamento global (exceto bossKill)
    globalCooldown: 0.15,   // intervalo mínimo entre congelamentos globais
    slowmoScale: 0.35,      // velocidade do jogo durante a câmera lenta
  },

  // reações a golpe: dur = duração da animação; stun = tempo sem poder agir;
  // amount = intensidade da pose
  reaction: {
    light:   { dur: 0.22, stun: 0,    amount: 1 },
    armored: { dur: 0.18, stun: 0,    amount: 0.4 },  // golpe leve em quem tem superarmadura
    heavy:   { dur: 0.45, stun: 0.35, amount: 1 },
    crit:    { dur: 0.4,  stun: 0.3,  amount: 1 },
    stagger: { dur: 1.1 },                            // postura quebrada: atordoado
    interruptCd: 0.7,       // atraso extra no próximo ataque de quem foi interrompido
    armorScale: 0.5,        // intensidade da reação forte em quem tem superarmadura (fora do cambaleio)
  },

  // empurrão: impulso = força / massa. A velocidade nunca passa do maior
  // impulso recebido nem de maxSpeed, então golpes seguidos não "empilham".
  knockback: { decay: 8, maxSpeed: 9 },

  // por tipo de inimigo: massa, postura (dano de postura até cambalear),
  // regeneração de postura por segundo e superarmadura (golpe leve não interrompe)
  enemies: {
    skeleton: { mass: 1.0, poise: 25,  poiseRegen: 18, superArmor: false, hitForce: 3.5 },
    wolf:     { mass: 0.8, poise: 15,  poiseRegen: 15, superArmor: false, hitForce: 3.0 },
    lord:     { mass: 4.0, poise: 150, poiseRegen: 12, superArmor: true,  hitForce: 7.0 },
  },
  poiseRegenDelay: 1.5,     // segundos sem apanhar até a postura começar a voltar

  // tremor de câmera ("trauma" somado, 0..1). scale = 0 desliga
  shake: { light: 0.16, heavy: 0.38, crit: 0.14, kill: 0.1, playerHurt: 0.3, playerHurtHeavy: 0.6, heavyMiss: 0.5, scale: 1 },
};

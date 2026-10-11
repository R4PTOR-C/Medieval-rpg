# Reino de Ferro

RPG medieval com câmera de cima (estilo CRPG), feito em JavaScript com [Three.js](https://threejs.org/).
Tudo é gerado por código: o terreno, a vila, a vegetação e os personagens. Não há nenhum arquivo de modelo 3D.
Aperte `T` para ver o mundo renderizado em caracteres ASCII.

## Como rodar

O jogo usa módulos ES, então precisa de um servidor local:

```bash
./jogar.sh            # sobe o servidor em http://localhost:8000
# ou
python3 -m http.server 8000
```

Depois é só abrir `http://localhost:8000` no navegador.

## Controles

| Tecla | Ação |
|---|---|
| Clique | mover / atacar (combo de 3 golpes) / falar |
| Shift + clique | atacar parado na direção do mouse |
| Botão direito ou R | golpe pesado com as duas mãos (dano em área) |
| Espaço | esquiva (rolamento com invencibilidade) |
| WASD / setas | andar |
| 1 | beber poção |
| F | falar |
| Q / E, botão do meio arrastando | girar câmera |
| Roda do mouse | zoom |
| T | liga/desliga o modo ASCII |
| `[` `]` | tamanho dos caracteres ASCII |
| G | densidade da grama |
| M | liga/desliga o som |

## Estrutura

```
index.html        HUD, telas e carregamento dos módulos
src/main.js       loop do jogo, entrada, combate, missões e HUD
src/world.js      céu, terreno, água com reflexo, vila, ruínas, vegetação e partículas
src/models.js     personagens: rig de juntas, peças e poses animadas
src/terrain.js    relevo, pontos de interesse e colisão
src/ascii.js      passe final: correção de cor do modo 3D e conversão para caracteres
src/geo.js        materiais, vento, recorte de oclusão e o Batch de geometria estática
src/fx.js         faíscas, anéis de impacto, rastro da espada e ossos que se despedaçam
src/audio.js      efeitos sonoros sintetizados com WebAudio (sem arquivos)
src/post.js       bloom
src/util.js       aleatório com semente, ruído e interpolação
```

### Personagens

Cada personagem é uma hierarquia de juntas (`makeRig`): quadril → coluna → peito → pescoço → cabeça,
mais ombro → cotovelo → mão e coxa → joelho → pé de cada lado. As peças (cilindros, caixas, esferas,
formas extrudadas) são presas nas juntas, e `poseHumanoid` / `poseWolf` calculam os ângulos a cada
quadro para a caminhada, a respiração e os golpes.

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
| Clique | mover / atacar / falar |
| WASD / setas | andar |
| Espaço | golpe |
| 1 | beber poção |
| F | falar |
| Q / E, botão direito arrastando | girar câmera |
| Roda do mouse | zoom |
| T | liga/desliga o modo ASCII |
| `[` `]` | tamanho dos caracteres ASCII |
| G | densidade da grama |

## Estrutura

```
index.html        HUD, telas e carregamento dos módulos
src/main.js       loop do jogo, entrada, combate, missões e HUD
src/world.js      céu, terreno, água com reflexo, vila, ruínas, vegetação e partículas
src/models.js     personagens: rig de juntas, peças e poses animadas
src/terrain.js    relevo, pontos de interesse e colisão
src/ascii.js      pós-processamento que converte a imagem em caracteres
src/geo.js        materiais, vento, recorte de oclusão e o Batch de geometria estática
src/util.js       aleatório com semente, ruído e interpolação
```

### Personagens

Cada personagem é uma hierarquia de juntas (`makeRig`): quadril → coluna → peito → pescoço → cabeça,
mais ombro → cotovelo → mão e coxa → joelho → pé de cada lado. As peças (cilindros, caixas, esferas,
formas extrudadas) são presas nas juntas, e `poseHumanoid` / `poseWolf` calculam os ângulos a cada
quadro para a caminhada, a respiração e os golpes.

// Shared sprite-atlas loader for all prototypes.
// Atlas: 3 cols x 2 rows of NPCs, each NPC has 4 dirs x 3 frames.
window.LC = (() => {
  const ATLAS_COLS = 3, ATLAS_ROWS = 2;
  const FRAMES = 3, DIRS = 4;
  const NPCS = ATLAS_COLS * ATLAS_ROWS;
  const DOWN = 0, LEFT = 1, RIGHT = 2, UP = 3;

  async function load(app, atlasUrl = '1.png', atlasCols = ATLAS_COLS, atlasRows = ATLAS_ROWS) {
    const { Assets, Texture, Rectangle, Graphics } = PIXI;
    const base = await Assets.load(atlasUrl);
    base.source.scaleMode = 'nearest';
    const npcCount = atlasCols * atlasRows;
    const fw = base.width / (atlasCols * FRAMES);
    const fh = base.height / (atlasRows * DIRS);

    const textures = Array.from({ length: npcCount }, (_, n) => {
      const cx = n % atlasCols, cy = (n / atlasCols) | 0;
      return Array.from({ length: DIRS }, (_, d) =>
        Array.from({ length: FRAMES }, (_, f) =>
          new Texture({
            source: base.source,
            frame: new Rectangle((cx * FRAMES + f) * fw, (cy * DIRS + d) * fh, fw, fh),
          })
        )
      );
    });

    const shadowG = new Graphics().ellipse(0, 0, fw * 0.4, fh * 0.12).fill({ color: 0x000000, alpha: 0.35 });
    const shadowTex = app.renderer.generateTexture(shadowG);
    shadowG.destroy();

    const partG = new Graphics().circle(0, 0, 8).fill(0xffffff);
    const partTex = app.renderer.generateTexture(partG);
    partG.destroy();

    return { textures, shadowTex, partTex, fw, fh, NPCS: npcCount, DOWN, LEFT, RIGHT, UP };
  }

  function makeTextTex(app, ch, color = 0xffe066, size = 18) {
    const t = new PIXI.Text({
      text: ch,
      style: { fontSize: size, fontWeight: 'bold', fill: color, stroke: { color: 0x000000, width: 3 } }
    });
    const tex = app.renderer.generateTexture(t);
    t.destroy();
    return tex;
  }

  // Compute facing dir from a (dx, dy) vector.
  function facing(dx, dy) {
    if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? LEFT : RIGHT;
    return dy < 0 ? UP : DOWN;
  }

  return { load, makeTextTex, facing, NPCS, DOWN, LEFT, RIGHT, UP };
})();

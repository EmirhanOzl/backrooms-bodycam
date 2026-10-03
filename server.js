// Backrooms: Bodycam — standalone server (static files + multiplayer).
// Usage: npm start (PORT=3000 BOTS=5 DIFF=1 FRAGS=25 TIME=600 MODE=ffa|tdm|escape LAYOUT=maze|arena|escape LIGHT=normal|dim|dark)
import { startGameServer, lanAddresses } from './lib/server.js';

const env = process.env;
const { port, core } = await startGameServer({
  port: +env.PORT || 3000,
  bots: env.BOTS ? +env.BOTS : 5,
  difficulty: env.DIFF ? +env.DIFF : 1,
  fragLimit: +env.FRAGS || 25,
  timeLimit: +env.TIME || 600,
  mode: env.MODE || 'ffa',
  layout: env.LAYOUT || 'maze',
  light: env.LIGHT || 'normal',
});
console.log(`Backrooms: Bodycam sunucusu hazır (${core.mode === 'escape' ? 'kaçış' : core.mode === 'tdm' ? 'takım çatışması' : 'herkes herkese'} / ${core.layout}) → http://localhost:${port}`);
for (const ip of lanAddresses()) console.log(`  Yerel ağdaki arkadaşların için: http://${ip}:${port}`);

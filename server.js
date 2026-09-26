// Backrooms: Bodycam — standalone server (static files + multiplayer).
// Usage: npm start   (PORT=3000 BOTS=5 DIFF=1 FRAGS=25 TIME=600 MODE=ffa|tdm LIGHT=normal|dim|dark)
import { startGameServer, lanAddresses } from './lib/server.js';

const env = process.env;
const { port, core } = await startGameServer({
  port: +env.PORT || 3000,
  bots: env.BOTS ? +env.BOTS : 5,
  difficulty: env.DIFF ? +env.DIFF : 1,
  fragLimit: +env.FRAGS || 25,
  timeLimit: +env.TIME || 600,
  mode: env.MODE === 'tdm' ? 'tdm' : 'ffa',
  light: env.LIGHT || 'normal',
});
console.log(`Backrooms: Bodycam sunucusu hazır (${core.mode === 'tdm' ? 'takım çatışması' : 'herkes herkese'}) → http://localhost:${port}`);
for (const ip of lanAddresses()) console.log(`  Yerel ağdaki arkadaşların için: http://${ip}:${port}`);

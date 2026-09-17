import { Chess } from 'chess.js';
import { readFileSync, writeFileSync } from 'node:fs';
const entries=JSON.parse(readFileSync(process.argv[2]??'data/lichess-selected.json','utf8'));
const seen=new Set(),counts={easy:0,normal:0,hard:0}, mates={},colors={},themes={};let duplicates=0;
for(const p of entries){
 const engine=new Chess(p.fen);
 for(let i=0;i<p.moves.length;i++){
  const code=p.moves[i]; engine.move({from:code.slice(0,2),to:code.slice(2,4),...(code[4]?{promotion:code[4]}:{})});
  if(i===0){const key=engine.fen().split(' ').slice(0,4).join(' ');if(seen.has(key))duplicates++;seen.add(key);colors[engine.turn()]=(colors[engine.turn()]??0)+1;}
  if(i<p.moves.length-1 && engine.isGameOver())throw Error('Early ending '+p.id);
 }
 if(!engine.isCheckmate()||p.moves.length!==p.mate*2)throw Error('Invalid mate '+p.id);
 counts[p.difficulty]++;mates[p.mate]=(mates[p.mate]??0)+1;for(const tag of p.themes)themes[tag]=(themes[tag]??0)+1;
 if(Object.values(counts).reduce((a,b)=>a+b,0)%5000===0)console.log(counts);
}
console.log(JSON.stringify({counts,mates,colors,duplicates,themes}));
if(duplicates)throw Error('Duplicate starting positions');
writeFileSync('server/puzzle-training.json',JSON.stringify(entries)+'\n');

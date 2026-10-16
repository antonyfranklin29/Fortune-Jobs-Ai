// Development preview; serves only public site assets, bound to this computer.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ttf':'font/ttf'};
http.createServer((req,res)=>{
  let name;try{name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
  if(name==='/')name='/index.html';
  const file=path.resolve(root,'.'+name),rel=path.relative(root,file);
  if(rel.startsWith('..')||path.isAbsolute(rel)||/(^|[\\/])\./.test(rel)||!types[path.extname(file)]
    ||(rel.includes(path.sep)&&!['config','vendor'].includes(rel.split(path.sep)[0]))){res.writeHead(404).end();return;}
  fs.readFile(file,(err,body)=>{if(err){res.writeHead(404).end();return;}
    res.writeHead(200,{'content-type':types[path.extname(file)],'cache-control':'no-store','x-content-type-options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:body);
  });
}).listen(8874,'127.0.0.1',()=>console.log('Site preview: http://127.0.0.1:8874'));

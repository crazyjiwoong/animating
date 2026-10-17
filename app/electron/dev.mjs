// 개발 모드: Vite 개발 서버를 띄우고 Electron 을 그 주소로 연다 (코드 수정 즉시 반영)
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

const server = await createServer({ server: { port: 5173 } });
await server.listen();
const url = server.resolvedUrls.local[0];
const args = ['.'];
if (process.getuid?.() === 0) args.push('--no-sandbox');
const child = spawn(electron, args, { stdio: 'inherit', env: { ...process.env, FRAMEFLOW_DEV_URL: url } });
child.on('close', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});

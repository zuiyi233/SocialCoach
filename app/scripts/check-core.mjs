import {spawnSync} from 'node:child_process';
// Windows: `pnpm` is pnpm.cmd, which spawnSync cannot resolve without a shell.
// With `shell: true` the args are still static script names — no injection surface.
const RUN = {stdio: 'inherit', shell: process.platform === 'win32'};
const scripts=['check-corpus.ts','check-pattern-guard.ts','check-practice-policy.ts','check-roleplay-output.ts','check-roleplay-facts.ts','check-store-recovery.ts','check-debrief-assistant.ts','check-practice-continuation.ts','check-model-availability.ts'];
for(const script of scripts){const result=spawnSync('pnpm',['exec','tsx',`scripts/${script}`],RUN);if(result.status!==0)process.exit(result.status??1);}
const denied=spawnSync('pnpm',['exec','tsx','scripts/check-store-recovery.ts','--unavailable'],RUN);process.exit(denied.status??1);

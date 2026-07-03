// Testful Explorer wrapper delegating to the unified CLI map module.
import { map } from '../../../../cli/lib/map.mjs';

const [pkg, runDir, maxActionsArg] = process.argv.slice(2);
if (!pkg || !runDir) {
  console.error('kullanım: explore.mjs <package> <run_dir> [maxActions]');
  process.exit(2);
}
const maxActions = Number(maxActionsArg || 80);

try {
  await map({
    pkg,
    out: runDir,
    maxActions,
    clear: true
  });
} catch (e) {
  console.error(`HATA: ${e.message}`);
  process.exit(1);
}

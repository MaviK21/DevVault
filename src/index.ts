import { run } from './cli/app';
import { EofError } from './cli/input';

run().then(
  () => {
    process.exit(0);
  },
  (error: unknown) => {
    if (error instanceof EofError) {
      process.stdout.write('\n');
      process.exit(0);
    }
    const message = error instanceof Error ? error.message : String(error);
    // Never print error objects that could contain secrets (ТЗ §43, §49).
    process.stdout.write(`\nERROR: ${message}\n`);
    process.exit(1);
  },
);

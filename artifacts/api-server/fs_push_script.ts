import { pushFreeSwitchConfig, testSSHConnection } from "./src/lib/freeswitchSSH";

async function main() {
  console.log("=== Testing SSH connection to FreeSWITCH ===");
  const test = await testSSHConnection();
  console.log(JSON.stringify(test, null, 2));
  if (!test.ok) {
    console.error("\nSSH test FAILED — aborting config push");
    process.exit(1);
  }

  console.log("\n=== Running FULL FreeSWITCH config push ===");
  const result = await pushFreeSwitchConfig({ lightReload: false });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

import { pushFreeSwitchConfig, testSSHConnection } from "./src/lib/freeswitchSSH";
async function main() {
  console.log("=== SSH test ===");
  const test = await testSSHConnection();
  console.log(JSON.stringify(test, null, 2));
  if (!test.ok) { console.error("SSH test FAILED"); process.exit(1); }
  console.log("\n=== Full config push ===");
  const result = await pushFreeSwitchConfig({ lightReload: false });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });

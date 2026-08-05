export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { scheduleStartupUnindexed } = await import("./lib/index-jobs");
  scheduleStartupUnindexed();
}

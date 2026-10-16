export function createCaptureActions({ requestPermission, start }) {
  let tail = Promise.resolve();
  const pending = new Map();
  function run(name, action) {
    if (pending.has(name)) return pending.get(name);
    const result = tail.then(action).then(
      (value) => { pending.delete(name); return value; },
      (error) => { pending.delete(name); throw error; },
    );
    pending.set(name, result);
    // A failed request must release the queue so the user can retry.
    tail = result.then(() => {}, () => {});
    return result;
  }
  return {
    requestPermission: () => run('permission', requestPermission),
    start: () => run('start', start),
  };
}

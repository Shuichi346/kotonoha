const productionPorts = [8765, 8770, 8771, 8772, 8773, 8774];

// Read the selected port from the owned child, never discover it through another service.
export function backendPort(child, requestedPort, labels, failure, timeoutMs = 30000) {
  const allowed = requestedPort === 8767 ? [8767] : productionPorts;
  return new Promise((resolve, reject) => {
    let pending = '';
    const finish = (error, port) => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onError);
      if (error) reject(error); else resolve(port);
    };
    const onExit = () => finish(new Error(failure() || labels().backendExited));
    const onError = () => finish(new Error(labels().missingPython));
    const onData = (chunk) => {
      pending += chunk;
      let index;
      while ((index = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        let report;
        try { report = JSON.parse(line); } catch { continue; }
        if (report.type === 'ports_unavailable') {
          finish(new Error(labels().portBusy.replace('{ports}', allowed.join(', '))));
          return;
        }
        if (report.type === 'service_port') {
          if (!allowed.includes(report.port)) finish(new Error(labels().invalidResponse));
          else finish(null, report.port);
          return;
        }
      }
      if (pending.length > 4096) finish(new Error(labels().invalidResponse));
    };
    const timer = setTimeout(() => finish(new Error(failure() || labels().pythonStartup)), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', onData);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

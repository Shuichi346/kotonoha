"""Bounded, disjoint loopback port pools for the two owned services."""

import errno
import socket

API_PORTS = (8765, 8770, 8771, 8772, 8773, 8774)
ASR_PORTS = (8766, 8780, 8781, 8782, 8783, 8784)


class PortsUnavailableError(RuntimeError):
    code = "ports_unavailable"

    def __init__(self, ports):
        self.ports = tuple(ports)
        super().__init__(
            "ローカルサービス用ポートがすべて使用中です: "
            + ", ".join(map(str, self.ports))
            + "。使用中のアプリやプロジェクトを確認し、ポートを空けてから再試行してください。"
        )


def bind_first_available(ports):
    """Keep the chosen listener bound so API startup cannot lose a port race."""
    for port in ports:
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("127.0.0.1", port))
            listener.listen(128)
            return listener
        except OSError as error:
            listener.close()
            if error.errno != errno.EADDRINUSE:
                raise
    raise PortsUnavailableError(ports)

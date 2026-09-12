import { Client, type ConnectConfig } from "ssh2";

export interface SshServerConfig {
  host: string;
  port: number;
  sshUser: string;
  sshAuthType: string; // password | privateKey
  sshPassword?: string | null;
  sshPrivateKey?: string | null;
}

export function buildConnectConfig(server: SshServerConfig): ConnectConfig {
  const config: ConnectConfig = {
    host: server.host,
    port: server.port,
    username: server.sshUser,
    readyTimeout: 15000,
  };
  if (server.sshAuthType === "privateKey") {
    config.privateKey = server.sshPrivateKey ?? undefined;
  } else {
    config.password = server.sshPassword ?? undefined;
  }
  return config;
}

export function sshConnect(server: SshServerConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn
      .on("ready", () => resolve(conn))
      .on("error", (err) => reject(err))
      .connect(buildConnectConfig(server));
  });
}

export function sshExec(conn: Client, command: string, timeoutMs = 30000): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        stream.close();
        reject(new Error(`命令执行超时（${timeoutMs}ms）: ${command}`));
      }, timeoutMs);
      stream
        .on("close", (code: number | null) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, code });
        })
        .on("data", (data: Buffer) => (stdout += data.toString()))
        .stderr.on("data", (data: Buffer) => (stderr += data.toString()));
    });
  });
}

export function sftpWriteFile(conn: Client, remotePath: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const tmpPath = `${remotePath}.pm.tmp`;
      const writeStream = sftp.createWriteStream(tmpPath);
      writeStream
        .on("error", reject)
        .on("close", () => {
          // 原子替换：先写临时文件再 rename
          sftp.rename(tmpPath, remotePath, (renameErr) => {
            if (renameErr) {
              // 某些服务器 rename 目标存在时需要先删除
              sftp.unlink(remotePath, () => {
                sftp.rename(tmpPath, remotePath, (retryErr) => {
                  sftp.end();
                  retryErr ? reject(retryErr) : resolve();
                });
              });
            } else {
              sftp.end();
              resolve();
            }
          });
        });
      writeStream.write(content, "utf-8");
      writeStream.end();
    });
  });
}

export function sftpReadFile(conn: Client, remotePath: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.stat(remotePath, (statErr) => {
        if (statErr) {
          sftp.end();
          return resolve(null); // 文件不存在
        }
        const chunks: Buffer[] = [];
        const stream = sftp.createReadStream(remotePath);
        stream
          .on("error", (readErr: Error) => {
            sftp.end();
            reject(readErr);
          })
          .on("data", (chunk: Buffer) => chunks.push(chunk))
          .on("end", () => {
            sftp.end();
            resolve(Buffer.concat(chunks).toString("utf-8"));
          });
      });
    });
  });
}

export function sshTestConnection(server: SshServerConfig): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    sshConnect(server)
      .then(async (conn) => {
        try {
          const { stdout } = await sshExec(conn, "uname -a");
          conn.end();
          resolve({ ok: true, message: stdout.trim().slice(0, 200) || "连接成功" });
        } catch (e) {
          conn.end();
          resolve({ ok: true, message: "连接成功（命令执行异常）" });
        }
      })
      .catch((err) => {
        resolve({ ok: false, message: err.message || "连接失败" });
      });
  });
}

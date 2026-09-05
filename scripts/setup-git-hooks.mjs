/**
 * postinstall：在 git 仓库内把 hooks 目录指向 .githooks（进版本控制的钩子，换机器/新克隆零配置）
 * 非 git 环境（如下载的源码包）静默跳过，不影响安装。
 */
import { execSync } from 'node:child_process'

try {
  execSync('git rev-parse --git-dir', { stdio: 'ignore' })
  execSync('git config core.hooksPath .githooks', { stdio: 'ignore' })
  console.log('[setup] git hooks 已启用（.githooks：changelog.ts 提交时自动同步 README）')
} catch {
  // 非 git 仓库，无需启用
}

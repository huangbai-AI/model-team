#!/bin/zsh
cd -- "${0:A:h}"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
node launch.mjs
if [[ $? -ne 0 ]]; then
  read 'reply?启动失败，按回车关闭。'
fi

#!/bin/bash
# Views.gs 를 Apps Script 프로젝트 "HAPPS Views" 에 올리고, 기존 웹앱 배포를 새 버전으로 바꿉니다.
# 웹앱 URL(index.html·admin.html 의 VIEWS_ENDPOINT)은 바뀌지 않습니다.
#
# 사용법:  scripts/deploy-views.sh "배포 설명"
#          scripts/deploy-views.sh --dry-run     (온라인 코드와 비교만 하고 올리지 않음)
#
# 처음 한 번 필요한 것: ~/.local/node 의 Node.js + clasp, `clasp login`,
# script.google.com/home/usersettings 에서 "Google Apps Script API" 사용.
set -euo pipefail

SCRIPT_ID='1xGMIqwi4oMfdCOwSE3b3JtDT3A3C5iRaSojdRppcTL1PiMjVU4goAi8n'
DEPLOYMENT_ID='AKfycbwsQoO3lS9wB6Ao-P0KECTOr7d4ylbXdz0IoY8kSVbikIRxh37k8gbuOPM7VRkL5z4Z'
ENDPOINT="https://script.google.com/macros/s/$DEPLOYMENT_ID/exec"

export PATH="$HOME/.local/node/bin:$PATH"
command -v clasp >/dev/null || { echo "clasp 가 없습니다 (~/.local/node/bin)."; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESC="${1:-}"
[ -n "$DESC" ] || { echo '배포 설명을 적어 주세요. 예: scripts/deploy-views.sh "HAPPS Views v6 (…)"'; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 1) 지금 온라인에 있는 코드를 받아 와서 무엇이 바뀌는지 보여 줍니다.
mkdir "$WORK/remote" "$WORK/push"
printf '{"scriptId":"%s","rootDir":"."}\n' "$SCRIPT_ID" > "$WORK/remote/.clasp.json"
(cd "$WORK/remote" && clasp pull >/dev/null)
REMOTE_FILES="$(cd "$WORK/remote" && ls | sort | tr '\n' ' ')"
if [ "$REMOTE_FILES" != "Code.js appsscript.json " ]; then
  echo "온라인 프로젝트 파일이 예상과 다릅니다: $REMOTE_FILES"
  echo "Code.gs 하나만 있다고 가정하고 만든 스크립트라서 멈춥니다."
  exit 1
fi
echo "── 온라인 Code.gs → 저장소 Views.gs 변경 내용 ──"
if diff -u "$WORK/remote/Code.js" "$ROOT/Views.gs" --label 온라인 --label Views.gs; then
  echo "(코드 차이 없음)"
fi

if [ "$DESC" = "--dry-run" ]; then exit 0; fi

# 2) 저장소의 Views.gs 를 Code.gs 로 올립니다 (매니페스트는 온라인 것을 그대로 씀).
cp "$WORK/remote/.clasp.json" "$WORK/remote/appsscript.json" "$WORK/push/"
cp "$ROOT/Views.gs" "$WORK/push/Code.js"
(cd "$WORK/push" && clasp push --force)

# 3) 기존 배포를 새 버전으로 바꿉니다.
(cd "$WORK/push" && clasp create-deployment --deploymentId "$DEPLOYMENT_ID" --description "$DESC")

# 4) 확인: 조회수를 올리지 않는 요청(nt=1)
echo "── 확인 ──"
curl -sSL "$ENDPOINT?page=store&nt=1"; echo

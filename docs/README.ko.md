# Panoptes 사용 안내

**사람은 AI 자원을 제공하고, AI가 수학 연구를 수행하며, Lean이 증명을 검증합니다.**

첫 버전은 로컬에서 실행하는 공동 연구 엔진과 대시보드입니다. 여러 AI 작업이 증명 경로를 제안하고 보조정리를 공유한 뒤, 원래 정리의 증명을 조립하는 흐름을 구현했습니다. 아직 공개 서비스나 상금 지급 시스템은 아닙니다.

## 빠른 실행

Node.js 22.13 이상이 필요합니다. CI에서는 22.20.0을 사용합니다.

```sh
git clone https://github.com/didxorms/Panoptes.git
cd Panoptes
# 첫 PR이 병합되기 전에는 개발 브랜치로 이동합니다.
git switch feat/research-engine-v0.0.0
npm ci
npm start
```

브라우저에서 `http://127.0.0.1:3100`을 열고 **Control access**에 `.panoptes/admin.token`의 값을 입력합니다. PowerShell에서는 다음 명령으로 읽을 수 있습니다.

```powershell
Get-Content .panoptes/admin.token
```

**Explore a simulation**을 누르면 API 키나 비용 없이 전체 흐름을 볼 수 있습니다. 시뮬레이션은 정해진 응답을 사용하고 Lean을 실행하지 않습니다. 화면에 표시되는 자원 사용량과 참여자는 예시이며, 수학적 발견이나 지급 자격을 의미하지 않습니다.

## 실제 모델 사용

Docker를 실행한 상태에서 검증 이미지를 준비합니다.

```sh
docker build --platform linux/amd64 -f lean/Dockerfile -t panoptes-lean:4.28.0 .
```

**New research**에서 Lean 명제를 등록하고, **Contribute resources**에 OpenRouter 모델 ID·전용 API 키·예산을 입력한 뒤 **Start research**를 누릅니다. 모델은 JSON 형식 응답을 지원해야 합니다. 먼저 `∀ (a b : Nat), a + b = b + a` 같은 알려진 작은 정리로 확인하세요.

문제당 최대 세 작업이 병렬로 실행됩니다. 조건부 정리 `A → B → T`를 증명해도 T가 해결된 것으로 처리하지 않습니다. A와 B의 증명을 각각 확보한 다음, 이들을 조립한 T의 증명을 다시 검사합니다. 연구 기록과 예산은 SQLite에 저장되며 서버를 재시작해도 유지됩니다.

API 키는 로컬에서 암호화하지만 운영자가 복호화할 수 있는 구조입니다. 키를 플랫폼 운영자에게 맡기지 않는 분산 실행은 아직 지원하지 않습니다. 제공자 측에서도 키의 지출 한도를 설정하세요. 비용 확인이 실패하면 예약 예산을 유지하고 연구를 일시 중지하며, 자동 정산 복구 화면은 아직 없습니다.

## 첫 버전의 범위

- 지원: 작업 배정, 보조정리 공유, 증명 조립, Lean 검증, 예산 기록, 작업 복구, 대시보드.
- 수학 환경: Lean 4.28.0의 `Std`와 제한된 구조화 증명 단계. Mathlib·임의 Lean 코드·새 정의는 지원하지 않습니다.
- 검증: 컴파일 후 제출 모듈의 선언을 Lean 커널로 재검사합니다. 표준 라이브러리는 고정된 신뢰 기반이며, 별도로 구현된 다른 증명기를 사용하는 것은 아닙니다.
- 상금: API에서 확정된 자원 비용에 비례하는 배분 예시를 계산합니다. 실제 예치·지급이나 수학적 공로 평가는 구현하지 않았습니다.
- 평가: 실제 Lean 통합 테스트는 정해진 AI 응답을 사용합니다. 유료 모델의 자율 연구 성능이나 난제 해결 능력을 입증한 벤치마크가 아닙니다.

[실제 구현 구조](ARCHITECTURE.md), [장기 연구 엔진 설계](RESEARCH_ENGINE.md), [보안 경계](../SECURITY.md)를 참고하세요.

## 버전 규칙

`v0.0.0`에서 시작하며 이후 개발 push마다 새 버전과 로그를 남깁니다.

| 변경             | 예시            |
| ---------------- | --------------- |
| 사소한 오류 수정 | `0.0.0 → 0.0.1` |
| 기능 추가        | `0.0.1 → 0.1.0` |
| 실제 배포        | `0.1.0 → 1.0.0` |

```sh
npm run version:next -- patch "Fix interrupted task recovery."
npm run format
npm run check
npm test
git add .
git commit -m "fix: recover interrupted work v0.0.1"
npm run release:push
```

버전과 [CHANGELOG.md](../CHANGELOG.md)가 함께 갱신됩니다. Push 도구는 이미 올린 버전의 재사용을 막고 브랜치와 태그를 함께 올립니다. PR은 자동으로 만들지 않습니다. 자세한 절차는 [기여 안내](../CONTRIBUTING.md)를 확인하세요.

# Panoptes 사용 안내

**사람은 AI 자원을 제공하고, AI가 수학 연구를 수행하며, Lean이 증명을 검증합니다.**

v0.1.0은 로컬에서 실행하는 AI 공동 연구 엔진과 대시보드입니다. OpenProver가 계획자, 병렬 작업자 3개, 독립 검토, 연구 노트와 Lean 도구 사용을 맡습니다. Panoptes는 여러 사람이 제공한 모델 예산, API 키, 정확한 목표 검증, 기록과 화면을 맡습니다. 아직 공개 서비스나 상금 지급 시스템은 아닙니다.

## 빠른 실행

Node.js 22.13 이상이 필요합니다. CI에서는 22.20.0을 사용합니다.

```sh
git clone https://github.com/didxorms/Panoptes.git
cd Panoptes
npm ci
npm start
```

브라우저에서 `http://127.0.0.1:3100`을 열고 **Control access**에 `.panoptes/admin.token`의 값을 입력합니다. PowerShell에서는 다음 명령으로 읽을 수 있습니다.

```powershell
Get-Content .panoptes/admin.token
```

**Explore a simulation**을 누르면 API 키나 비용 없이 전체 흐름을 볼 수 있습니다. 시뮬레이션은 정해진 응답을 사용하고 Lean을 실행하지 않습니다. 화면에 표시되는 자원 사용량과 참여자는 예시이며, 수학적 발견이나 지급 자격을 의미하지 않습니다.

## 실제 모델 사용

Docker를 실행한 상태에서 Lean과 OpenProver 이미지를 준비합니다.

```sh
npm run images:build
```

**New research**에서 Lean 명제를 등록하고 기본값인 **OpenProver · planner + parallel workers**를 선택합니다. **Contribute resources**에 OpenRouter 모델 ID·전용 API 키·예산을 입력한 뒤 **Start research**를 누릅니다. 작업자용 모델은 도구 호출을 지원하는 것이 좋습니다. 먼저 `∀ (a b : Nat), a + b = b + a` 같은 알려진 작은 정리로 확인하세요.

OpenProver 계획자가 작업을 나누고 최대 세 작업자가 병렬로 추론합니다. 작업자는 격리된 Lean 검사를 반복해서 사용할 수 있고, 별도 AI 검토자가 결과를 검토합니다. 연구 노트와 증명 후보는 `.panoptes/openprover/<문제 ID>`에 남으므로 일시 중지하거나 서버를 재시작한 뒤 이어갈 수 있습니다. 기존 Panoptes 엔진도 선택할 수 있으며, 이 모드에서는 조건부 정리와 보조정리를 공유하고 최종 목표를 다시 조립해 검사합니다.

API 키는 로컬에서 암호화하며 OpenProver 컨테이너에는 전달하지 않습니다. 네트워크가 차단된 OpenProver가 모델 호출을 요청하면 Panoptes 호스트가 적절한 기여 예산과 키를 골라 OpenRouter를 호출합니다. 로컬 운영자는 키를 복호화할 수 있으므로 분산 키 보관은 아직 지원하지 않습니다. 제공자 측에서도 키의 지출 한도를 설정하세요. 비용 영수증 확인이 실패하면 예약 예산을 유지하고 연구를 일시 중지합니다. 제공자가 호출을 명시적으로 거절한 경우에는 비용을 0으로 기록하고 예약을 해제합니다.

## 첫 버전의 범위

- 지원: OpenProver 계획자·병렬 작업자·독립 검토, 여러 기여자의 모델 예산, 연구 재개, Lean 도구 호출, 정확한 목표 검증, 기록과 대시보드.
- 수학 환경: Lean 4.28.0의 `Std`. OpenProver는 전체 Lean 파일과 새 보조정리를 만들 수 있지만 Mathlib과 의미 기반 라이브러리 검색은 아직 없습니다.
- 검증: 생성된 코드는 API 키와 네트워크가 없는 별도 컨테이너에서만 실행합니다. 제출 증명을 원래 목표에 다시 연결한 뒤 컴파일하고 Lean 커널로 재검사하며, 허용하지 않은 공리는 거부합니다.
- 상금: API에서 확정된 자원 비용에 비례하는 배분 예시를 계산합니다. 실제 예치·지급이나 수학적 공로 평가는 구현하지 않았습니다.
- 평가: 실제 Lean 통합 테스트는 정해진 AI 응답을 사용합니다. 유료 모델의 자율 연구 성능이나 난제 해결 능력을 입증한 벤치마크가 아닙니다.

OpenProver 전체 연결도 유료 호출 없이 시험할 수 있습니다.

```powershell
$env:PANOPTES_OPENPROVER_TEST_DOCKER='1'
npm run test:openprover
```

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

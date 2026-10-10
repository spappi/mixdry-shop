# 리버싱 워크벤치 v5.0.1 작업지시서 — JS 출력 디렉토리 생성 누락 수정

## 1. 버그

v5.0 추출 시 다음과 같은 빨간 에러가 대량 발생:
```
[에셋 실패] js/script-0.js - ENOENT: no such file or directory, open '...\js\script-0.js'
[에셋 실패] js/inline-0.js - ENOENT: no such file or directory, open '...\js\inline-0.js'
```

## 2. 원인

`main.js`의 JS 처리 로직에서 디렉토리 생성 누락.

**inline-js 처리 (약 1565행):**
```js
fs.mkdirSync(path.join(outDir, 'original', path.dirname(item.localPath)), { recursive: true });
fs.writeFileSync(path.join(outDir, 'original', item.localPath), item.text);
fs.writeFileSync(path.join(outDir, item.localPath), stubbed);  // ← 여기서 ENOENT!
```

**외부 JS 처리 (약 1678행):**
```js
fs.mkdirSync(path.join(outDir, 'original', path.dirname(item.localPath)), { recursive: true });
fs.writeFileSync(path.join(outDir, 'original', item.localPath), bodyData.buf);
fs.writeFileSync(path.join(outDir, item.localPath), stubbed);  // ← 여기서 ENOENT!
```

`mkdirSync`는 `outDir/original/js/`만 만들고, `outDir/js/`는 만들지 않음.
그 다음 `outDir/js/script-0.js`에 쓰려고 하면 디렉토리가 없어서 ENOENT 발생.

## 3. 수정

두 곳 모두에서 스텁 파일을 쓰기 전에 메인 출력 디렉토리도 생성:

```js
// original/ 디렉토리 생성 (기존)
fs.mkdirSync(path.join(outDir, 'original', path.dirname(item.localPath)), { recursive: true });
// 메인 출력 디렉토리 생성 (추가)
fs.mkdirSync(path.join(outDir, path.dirname(item.localPath)), { recursive: true });
// 파일 쓰기
fs.writeFileSync(path.join(outDir, 'original', item.localPath), ...);
fs.writeFileSync(path.join(outDir, item.localPath), ...);
```

## 4. 검증

- `node --check main.js` 통과
- t-print 재추출 시 `[에셋 실패] js/...` 에러가 사라지는지 확인
- `js/original/`와 `js/` 양쪽에 파일이 생성되는지 확인

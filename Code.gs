/**
 * 학급 활동 순서 도우미 - Google Apps Script (Code.gs)
 * 
 * [구글 스프레드시트 열(스키마) 규격]
 * - A열(1열): 활동 이름 (문자열, 필수, 1~50자)
 * - B열(2열): 순서 목록 (정수 숫자, 필수, 1부터 시작하는 진행 순번)
 * 
 * [중요 보안 및 무결성 원칙]
 * 1. 시트 1행의 열 이름이 '활동 이름', '순서 목록'과 다르면 임의로 덮어쓰지 않고 불일치 에러를 반환합니다.
 * 2. 학생 이름/개인정보는 저장하지 않으며 활동명만 저장합니다.
 * 3. 2행부터의 활동 데이터만 읽기/저장하며 시트의 다른 영역은 수정하지 않습니다.
 */

// 필수 헤더 명칭 상수
const REQUIRED_HEADER_A = '활동 이름';
const REQUIRED_HEADER_B = '순서 목록';

/**
 * 시트 헤더 검증 함수
 * 1행의 열 이름과 순서가 정확히 일치하는지 확인합니다.
 * 불일치 시 임의로 덮어쓰지 않고 명확한 에러를 발생시킵니다.
 */
function validateHeaders(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 2) {
    return {
      valid: false,
      message: "시트에 최소 2개 이상의 열이 필요합니다. A1: '활동 이름', B1: '순서 목록'을 입력해 주세요."
    };
  }

  const h1 = String(sheet.getRange(1, 1).getValue() || '').trim();
  const h2 = String(sheet.getRange(1, 2).getValue() || '').trim();

  if (h1 !== REQUIRED_HEADER_A || h2 !== REQUIRED_HEADER_B) {
    return {
      valid: false,
      message: `시트 1행의 열 이름이 일치하지 않습니다. (현재 A1: "${h1}", B1: "${h2}") -> 반드시 A1: "${REQUIRED_HEADER_A}", B1: "${REQUIRED_HEADER_B}"이어야 합니다.`
    };
  }

  return { valid: true };
}

/**
 * GET 요청 처리 (데이터 불러오기 / 헬스체크)
 */
function doGet(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    
    // 1. 헤더 검증 (임의 덮어쓰기 금지)
    const headerCheck = validateHeaders(sheet);
    if (!headerCheck.valid) {
      return jsonResponse({
        success: false,
        error: headerCheck.message,
        code: 'HEADER_MISMATCH'
      });
    }

    // 2. 활동 데이터 읽기
    const lastRow = sheet.getLastRow();
    const rows = [];

    if (lastRow > 1) {
      const data = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
      for (let i = 0; i < data.length; i++) {
        const rawName = data[i][0];
        const rawOrder = data[i][1];
        
        const activityName = String(rawName || '').trim();
        const orderNum = parseInt(rawOrder, 10);

        // 필수값 검증: 활동 이름이 존재하는 행만 채택
        if (activityName) {
          rows.push({
            activity: activityName,
            order: isNaN(orderNum) ? (i + 1) : orderNum
          });
        }
      }
      
      // 순서 목록 기준 오름차순 정렬
      rows.sort((a, b) => a.order - b.order);
    }

    return jsonResponse({
      success: true,
      data: rows,
      totalCount: rows.length
    });

  } catch (err) {
    return jsonResponse({
      success: false,
      error: '시트 데이터를 불러오는 중 오류가 발생했습니다: ' + err.toString(),
      code: 'SERVER_ERROR'
    });
  }
}

/**
 * POST 요청 처리 (데이터 저장하기)
 */
function doPost(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

    // 1. 헤더 검증 (임의 덮어쓰기 금지)
    const headerCheck = validateHeaders(sheet);
    if (!headerCheck.valid) {
      return jsonResponse({
        success: false,
        error: headerCheck.message,
        code: 'HEADER_MISMATCH'
      });
    }

    // 2. 요청 본문(Payload) 파싱
    let items = [];
    if (e && e.postData && e.postData.contents) {
      const parsed = JSON.parse(e.postData.contents);
      items = Array.isArray(parsed) ? parsed : (parsed.items || []);
    } else if (e && e.parameter && e.parameter.data) {
      items = JSON.parse(e.parameter.data);
    }

    if (!Array.isArray(items)) {
      return jsonResponse({
        success: false,
        error: '전달된 데이터 형식이 올바르지 않습니다. (배열 형태 필요)',
        code: 'INVALID_PAYLOAD'
      });
    }

    // 3. 입력 데이터 검증 및 행 데이터 구성
    const newRows = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const activityName = typeof item === 'string' ? item.trim() : String(item.activity || '').trim();
      const orderVal = (typeof item === 'object' && item.order !== undefined) ? parseInt(item.order, 10) : (i + 1);

      // 빈 활동명 차단
      if (!activityName) {
        continue;
      }

      // 최대 글자수 및 자료형 검증
      if (activityName.length > 50) {
        return jsonResponse({
          success: false,
          error: `활동 이름은 최대 50자 이하이어야 합니다. ("${activityName.substring(0, 10)}...")`,
          code: 'VALIDATION_ERROR'
        });
      }

      newRows.push([activityName, isNaN(orderVal) ? (i + 1) : orderVal]);
    }

    // 4. 기존 데이터 행(2행부터)만 초기화 (1행 헤더 보존)
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, 2).clearContent();
    }

    // 5. 새 데이터 쓰기
    if (newRows.length > 0) {
      sheet.getRange(2, 1, newRows.length, 2).setValues(newRows);
    }

    return jsonResponse({
      success: true,
      savedCount: newRows.length,
      message: `성공적으로 ${newRows.length}개의 활동이 구글 시트에 저장되었습니다.`
    });

  } catch (err) {
    return jsonResponse({
      success: false,
      error: '시트 데이터를 저장하는 중 오류가 발생했습니다: ' + err.toString(),
      code: 'SERVER_ERROR'
    });
  }
}

/**
 * JSON 응답 생성 헬퍼
 */
function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

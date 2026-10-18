/**
 * Every player-facing string in the web app (spec §3: the UI is in Thai).
 * Components never type UI text inline; they call `t(key)`. Numbers are not
 * written here: they come from the engine (spec §3.1).
 */
export const th = {
  'app.title': 'โปเก โมโนโพลี',

  'steps.label': 'ลำดับหน้าจอ',
  'steps.home': 'หน้าแรก',
  'steps.setup': 'ตั้งค่า',
  'steps.play': 'เล่น',
  'steps.results': 'ผลการแข่งขัน',

  'nav.home': 'กลับหน้าแรก',
  'nav.setup': 'ไปหน้าตั้งค่าเกม',
  'nav.play': 'ไปหน้าเล่นเกม',
  'nav.results': 'ไปหน้าผลการแข่งขัน',

  'home.heading': 'เกมกระดานแข่งกับคู่แข่ง AI',
  'home.body':
    'หน้าเล่นเกมยังอยู่ระหว่างสร้าง ตอนนี้ยังเริ่มเกมจริงไม่ได้ ใช้ปุ่มด้านล่างเพื่อดูหน้าตั้งค่าเกม',
  'setup.heading': 'ตั้งค่าเกม',
  'setup.body':
    'หน้านี้จะใช้เลือกโหมดเกม คลาส และคู่แข่ง AI ตอนนี้ยังเลือกไม่ได้ ไปหน้าเล่นเกมต่อ หรือกลับหน้าแรก',
  'play.heading': 'กระดานเกม',
  'play.body':
    'หน้านี้จะแสดงกระดาน ทีม ไอเทม แชต และบันทึกเหตุการณ์ ตอนนี้ยังเล่นไม่ได้ ไปหน้าผลการแข่งขันต่อ หรือกลับหน้าแรก',
  'results.heading': 'ผลการแข่งขัน',
  'results.body':
    'หน้านี้จะแสดงผลของผู้เล่นทุกคนเมื่อจบเกม ตอนนี้ยังไม่มีผล กลับหน้าแรกเพื่อเริ่มดูใหม่',

  'error.heading': 'หน้านี้แสดงผลไม่ได้',
  'error.body':
    'เกิดข้อผิดพลาดระหว่างแสดงหน้าจอ กด “ลองอีกครั้ง” หากยังเห็นข้อความนี้ ให้โหลดหน้าเว็บใหม่',
  'error.retry': 'ลองอีกครั้ง',

  // Spec §3.1: status messages and actions, not AI dialogue from the line bank.
  'turn.onlyLegalAction': 'มีตัวเลือกที่ทำได้เพียงอย่างเดียว เกมจะดำเนินการให้อัตโนมัติ',
  'turn.noAvailableOptions': 'ไม่มีตัวเลือกในขั้นตอนนี้ เกมจะข้ามไปขั้นตอนถัดไป',

  'encounter.catch': 'จับโปเกมอน',
  'encounter.release': 'ปล่อยโปเกมอน',
  'encounter.noBall': 'ไม่มีบอล จับโปเกมอนไม่ได้ ให้เลือกปล่อยโปเกมอน',

  'shop.notEnoughCoins': 'เหรียญไม่พอสำหรับไอเทมนี้ ข้ามร้านค้าได้โดยไม่ซื้อ',
  'shop.itemsFull':
    'ถือไอเทมครบจำนวนสูงสุดแล้ว ซื้อไอเทมเพิ่มไม่ได้ แต่ยังซื้อบอลหรือข้ามร้านค้าได้',
  'shop.skip': 'ข้ามร้านค้า',

  'ai.backupBadge': 'โหมดบอตสำรอง',
  'ai.backupUnavailable': 'ระบบตัดสินใจของ AI ไม่พร้อมใช้งาน บอตสำรองจะตัดสินใจแทน เกมเล่นต่อได้',
  'deal.reconfirmAfterFallback':
    'เปลี่ยนมาใช้บอตสำรองแล้ว ยังไม่มีการแลกเปลี่ยน ตรวจสอบการ์ดแลกเปลี่ยนแล้วกดยืนยันอีกครั้ง',
  'deal.confirm': 'ยืนยันการแลกเปลี่ยน',
  'ai.backupInvalidAnswer':
    'คำตอบของ AI ไม่ตรงกับตัวเลือกที่ใช้ได้ บอตสำรองจะตัดสินใจแทน เกมเล่นต่อได้',
  'ai.backupRevisionMismatch':
    'คำตอบของ AI อ้างอิงข้อมูลคนละฉบับ บอตสำรองจะตัดสินใจจากข้อมูลปัจจุบัน',
  'ai.backupLowConfidence': 'AI ยังไม่มั่นใจ บอตสำรองจะช่วยเลือกตามบุคลิกของ AI',
  'ai.allBackupBanner': 'คู่แข่ง AI ทุกคนกำลังใช้บอตสำรอง เกมยังเล่นต่อได้ตามกติกาเดิม',

  'chat.unclassified':
    'ยังตีความข้อความนี้ไม่ได้ ลองเลือกหัวข้อแชตหรือพิมพ์ให้ชัดเจนขึ้น แผนของ AI ยังไม่เปลี่ยน',
  'chat.manipulationRefused':
    'ส่งข้อความใหม่โดยไม่ขอให้ทำผิดกติกาหรือเปิดเผยข้อมูลลับ ความเต็มใจและความไว้วางใจของ AI ยังไม่เปลี่ยน',

  'game.resumedAiTurn':
    'กลับมาเล่นต่อจากการกระทำล่าสุดที่บันทึกแล้ว กำลังให้ AI ตัดสินใจใหม่ในเทิร์นเดิม',
  'sell.rescueStarter':
    'ไม่มีโปเกมอนเหลือหลังช่วงขาย ได้รับโปเกมอนเริ่มต้นช่วยเหลือแล้ว เล่นต่อได้',
  'event.deckReshuffled': 'กองการ์ดเหตุการณ์หมดแล้ว สับการ์ดที่ใช้แล้วกลับเป็นกองจั่วเพื่อเล่นต่อ',
} as const satisfies Record<string, string>;

export type MessageKey = keyof typeof th;

export function t(key: MessageKey): string {
  return th[key];
}

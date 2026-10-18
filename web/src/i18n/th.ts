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
} as const satisfies Record<string, string>;

export type MessageKey = keyof typeof th;

export function t(key: MessageKey): string {
  return th[key];
}

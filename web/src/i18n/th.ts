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
  'nav.back': 'ย้อนกลับ',
  'nav.play': 'ไปหน้าเล่นเกม',
  'nav.results': 'ไปหน้าผลการแข่งขัน',

  'home.heading': 'แข่งสะสมเหรียญกับคู่แข่ง AI',
  'home.body':
    'ทอยลูกเต๋าเดินรอบกระดาน จับโปเกมอนด้วยบอล แล้วเลือกว่าจะเก็บไว้หรือขายที่จุดเริ่มต้น ผู้ที่มีเหรียญมากที่สุดเมื่อจบเกมเป็นผู้ชนะ',
  'home.newGame': 'เริ่มเกมใหม่',
  'home.newGameHint': 'เลือกโหมด คลาส และคู่แข่ง AI ทีละขั้น',
  'home.randomAll': 'สุ่มทั้งหมด',
  'home.randomAllHint': 'สุ่มโหมด คลาส และคู่แข่ง AI ให้ทันที แล้วตรวจสอบก่อนเริ่มเกม',
  'home.notEnoughClasses':
    'ข้อมูลเกมมีคลาสที่เลือกได้ไม่พอสำหรับผู้เล่นทุกคน จึงเริ่มเกมไม่ได้ ให้ทีมพัฒนาตรวจไฟล์คลาส',

  'home.boardCaption': 'ช่องบนกระดาน',
  'board.kind.start': 'จุดเริ่มต้น',
  'board.kind.wild': 'ช่องโปเกมอนป่า',
  'board.kind.event': 'เหตุการณ์',
  'board.kind.shop': 'ร้านค้า',
  'board.kind.gym': 'ยิม',

  'setup.steps.label': 'ขั้นตอนตั้งค่าเกม',
  'setup.step.mode': 'โหมด',
  'setup.step.class': 'คลาส',
  'setup.step.opponents': 'คู่แข่ง AI',
  'setup.step.review': 'ตรวจสอบ',
  'setup.step.firstPlayer': 'ทอยหาผู้เริ่ม',

  'mode.heading': 'เลือกโหมดเกม',
  'mode.body': 'โหมดกำหนดจำนวนรอบที่ผู้เล่นต้องเดินผ่านจุดเริ่มต้นก่อนเกมจะจบ',
  'mode.lapsUnit': 'รอบ',
  'mode.quick': 'เกมเร็ว',
  'mode.quickHint': 'เกมสั้น เหมาะกับการเล่นครั้งแรก',
  'mode.standard': 'มาตรฐาน',
  'mode.standardHint': 'เกมยาวขึ้น มีเวลาสะสมโปเกมอนและเหรียญมากขึ้น',
  'mode.standardClosed': 'โหมดมาตรฐานจะเปิดหลังการทดสอบเล่น',

  'class.heading': 'เลือกคลาสของคุณ',
  'class.body':
    'คลาสกำหนดโปเกมอนเริ่มต้น ความสามารถติดตัว และไอเทมประจำคลาส ในเกมเดียวกันแต่ละคลาสมีผู้เล่นได้คนเดียว',
  'class.passive': 'ความสามารถติดตัว',
  'class.item': 'ไอเทมประจำคลาส',
  'class.starter': 'โปเกมอนเริ่มต้น',
  'class.chooseStarter': 'เลือกโปเกมอนเริ่มต้นเพื่อใช้คลาสนี้',
  'class.closedHeading': 'คลาสที่ยังเลือกไม่ได้',
  'class.comingLater': 'ยังเลือกไม่ได้ จะเปิดให้เลือกภายหลัง',
  'class.name.main-character': 'ตัวเอก',
  'class.name.rival': 'คู่ปรับ',
  'class.name.fisherman': 'ชาวประมง',
  'class.name.nurse-joy': 'คุณจอย',
  'class.name.bug-catcher': 'นักจับแมลง',
  'class.name.researcher': 'นักวิจัย',
  'class.passive.main-character': 'ได้โบนัสในการทอยจับโปเกมอนครั้งแรกของแต่ละรอบ',
  'class.passive.researcher': 'ได้โบนัสเมื่อขายโปเกมอนตัวแรกที่จุดเริ่มต้นในแต่ละรอบ',

  'species.porygon': 'โพรีกอน',
  'species.bulbasaur': 'ฟุชิกิดาเนะ',
  'species.charmander': 'ฮิโตคาเงะ',
  'species.squirtle': 'เซนิกาเมะ',

  'item.potion': 'โพชั่น',
  'item.great-ball': 'ซูเปอร์บอล',

  'opponents.heading': 'ตั้งค่าคู่แข่ง AI',
  'opponents.body':
    'รุ่นทดสอบนี้เล่นกับคู่แข่ง AI หนึ่งคน เลือกคลาส บุคลิก และระดับความยากของคู่แข่ง บุคลิกไม่ขึ้นกับคลาส',
  'opponents.class': 'คลาสของคู่แข่ง',
  'opponents.classTaken': 'คุณเลือกคลาสนี้แล้ว คลาสในเกมเดียวกันต้องไม่ซ้ำกัน',
  'opponents.starter': 'โปเกมอนเริ่มต้นของคู่แข่ง',
  'opponents.personality': 'บุคลิก',
  'opponents.personalityClosed': 'บุคลิกนี้จะเปิดให้เลือกภายหลัง',
  'opponents.difficulty': 'ระดับความยาก',
  'opponents.difficultyHint': 'ทุกระดับมองเห็นข้อมูลตามสิทธิ์เดียวกับผู้เล่น',
  'opponents.noFreeClass': 'ไม่มีคลาสเหลือให้คู่แข่ง ย้อนกลับไปเลือกคลาสอื่นให้ตัวเอง',
  'opponents.next': 'ไปหน้าตรวจสอบ',

  'personality.greedy': 'โลภ',
  'personality.aggressive': 'ดุดัน',
  'personality.cautious': 'ระมัดระวัง',
  'personality.opportunist': 'ฉวยโอกาส',

  'difficulty.easy': 'ง่าย',
  'difficulty.easyHint': 'สุ่มเลือกตามความน่าจะเป็นที่ AI ให้แต่ละตัวเลือก',
  'difficulty.normal': 'ปกติ',
  'difficulty.normalHint': 'ได้ข้อมูลประกอบเพิ่ม และเลือกตัวเลือกที่ AI ให้คะแนนสูงสุด',

  'seat.you': 'คุณ',
  'seat.ai': 'คู่แข่ง AI',

  'review.heading': 'ตรวจสอบการตั้งค่า',
  'review.body':
    'ที่นั่งเรียงตามรายการนี้ ทุกคนทอยลูกเต๋าหาผู้เริ่มก่อน ผู้ที่ได้แต้มสูงสุดเริ่มก่อน แล้วเล่นต่อตามลำดับที่นั่ง',
  'review.mode': 'โหมด',
  'review.seats': 'ผู้เล่นตามลำดับที่นั่ง',
  'review.roll': 'ทอยลูกเต๋าหาผู้เริ่มก่อน',
  'review.startFailed':
    'สร้างเกมจากการตั้งค่านี้ไม่ได้ ย้อนกลับไปเลือกคลาสหรือคู่แข่งใหม่ แล้วลองอีกครั้ง',

  'firstPlayer.heading': 'ทอยหาผู้เริ่มก่อน',
  'firstPlayer.body': 'ผู้ที่ได้แต้มสูงสุดเริ่มก่อน ถ้าแต้มสูงสุดเสมอ เฉพาะผู้ที่เสมอทอยใหม่',
  'firstPlayer.attempt': 'การทอยครั้งที่',
  'firstPlayer.points': 'แต้ม',
  'firstPlayer.waiting': 'รอทอย',
  'firstPlayer.tie': 'แต้มสูงสุดเสมอกัน เฉพาะผู้ที่เสมอทอยใหม่',
  'firstPlayer.yourTie': 'คุณได้แต้มสูงสุดเท่ากับผู้เล่นอื่น ทอยอีกครั้งเพื่อหาผู้เริ่มก่อน',
  'firstPlayer.rollAgain': 'ทอยอีกครั้ง',
  'firstPlayer.youStart': 'คุณเริ่มก่อน',
  'firstPlayer.aiStarts': 'คู่แข่ง AI เริ่มก่อน',
  'firstPlayer.thenSeatOrder': 'จากนั้นเล่นต่อตามลำดับที่นั่ง',
  'firstPlayer.toBoard': 'ไปที่กระดาน',
  'firstPlayer.quit': 'เลิกเกมนี้และกลับหน้าแรก',

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

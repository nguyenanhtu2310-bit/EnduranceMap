import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'vi';

const STORAGE_KEY = 'endurancemap.lang';

/**
 * Vietnamese for the English it is keyed by.
 *
 * The key is the English string itself, not an invented code. Two reasons: nothing has
 * to be named twice, and anything not yet translated renders as English rather than as
 * a missing-key placeholder — so the tool is usable in Vietnamese from the first entry
 * added, and stays usable while the rest follow.
 *
 * The terms are race-operations terms, not literal translations: a "checkpoint" is a
 * "trạm", a "cut-off time" is "thời gian giới hạn" — what a Vietnamese race director
 * would say out loud.
 */
const VI: Record<string, string> = {
  // — masthead and race files —
  'New race': 'Giải mới',
  'Save race': 'Lưu giải',
  'Open…': 'Mở…',
  'Untitled race': 'Giải chưa đặt tên',
  'Race CP Operations Calculator': 'Công cụ tính vận hành trạm',
  'Turn a course map into a checkpoint operating schedule.':
    'Biến bản đồ đường đua thành lịch vận hành các trạm.',

  // — the REQUEST part —
  'Course map': 'Bản đồ đường đua',
  'CP type': 'Loại trạm',
  'Pace distribution': 'Mô hình pace',
  'Race details and pace band': 'Chi tiết đường đua',
  'Operating details': 'Thông số vận hành',
  CALCULATE: 'TÍNH TOÁN',

  // — the RESULT part —
  'Station operating schedule': 'Lịch vận hành trạm',
  'Course amenities': 'Chi tiết trạm theo từng cự ly',
  'Split calculation': 'Bảng split theo cự ly',
  'Crossing time distribution': 'Phân bố thời gian qua trạm',
  'Traffic at each station': 'Lưu lượng tại từng trạm',
  'Cut-off times': 'Thời gian giới hạn (COT)',
  Export: 'Xuất file',

  // — table columns —
  Station: 'Trạm',
  Stations: 'Trạm',
  Distance: 'Cự ly',
  Crossings: 'Lượt qua',
  Open: 'Mở',
  Close: 'Đóng',
  Duration: 'Thời lượng',
  'Peak window': 'Khung cao điểm',
  Peak: 'Cao điểm',
  min: 'phút',
  Activity: 'Mức độ',
  Point: 'Điểm',
  'At km': 'Tại km',
  'Gap from previous': 'Khoảng cách từ điểm trước',
  'Cut-off': 'Giới hạn',
  'Timing point': 'Điểm bấm giờ',
  Operating: 'Vận hành',
  Km: 'Km',
  'Slowest arrival': 'VĐV chậm nhất',
  'Proposed cut-off': 'COT đề xuất',
  Margin: 'Biên độ',
  'Provided COT': 'COT ban tổ chức',
  'Busiest distance': 'Cự ly đông nhất',
  'First Male': 'Nam đầu tiên',
  'First Female': 'Nữ đầu tiên',
  Total: 'Tổng',
  All: 'Tất cả',

  // — station traffic —
  'Operating time': 'Thời gian vận hành',
  'Total visits': 'Tổng lượt qua',
  Busiest: 'Cao điểm',
  'First through': 'Người đầu tiên',
  Finish: 'Về đích',
  at: 'lúc',
  Male: 'Nam',
  Female: 'Nữ',

  // — activity levels —
  Low: 'Thấp',
  Medium: 'Trung bình',
  High: 'Cao',

  // — controls —
  Stretch: 'Kéo ngang',
  Height: 'Chiều cao',
  Fit: 'Vừa khung',
  'Show table': 'Xem bảng',
  'Show chart': 'Xem biểu đồ',
  'Scale: shared': 'Thang đo: chung',
  'Scale: per station': 'Thang đo: theo trạm',
  'Collapse all sections': 'Thu gọn tất cả',
  'Expand all sections': 'Mở rộng tất cả',
  'Collapse all stations': 'Thu gọn tất cả trạm',
  'Expand all stations': 'Mở rộng tất cả trạm',
  'Download dark report': 'Tải báo cáo nền tối',
  'Download print report': 'Tải báo cáo in',
  'Download spreadsheet': 'Tải file bảng tính',
  'Download crew sheets': 'Tải phiếu trạm',
  'One A4 landscape page per station, ready to print and hand out':
    'Mỗi trạm một trang A4 ngang, in ra là phát được ngay',
  'Race name': 'Tên giải',
  'Select all': 'Chọn tất cả',
  Clear: 'Bỏ chọn',
  'Choose a different file': 'Chọn file khác',
  Remove: 'Xoá',
  Loaded: 'Đã tải',
  'Not used': 'Không dùng',

  // — the REQUEST tables —
  'Contest in file': 'Cự ly trong file',
  'Race in file': 'Giải trong file',
  Finishers: 'Số VĐV hoàn thành',
  Starters: 'Số VĐV xuất phát',
  Usable: 'Dùng được',
  'Pace P1 / P50 / P99': 'Pace P1 / P50 / P99',
  'Start spread': 'Độ giãn xuất phát',
  'Use for': 'Dùng cho',
  Measured: 'Đo được',
  Start: 'Xuất phát',
  'Spread (min)': 'Độ giãn (phút)',
  Runners: 'Số VĐV',
  Fastest: 'Nhanh nhất',
  Typical: 'Trung bình',
  Slowest: 'Chậm nhất',
  COT: 'COT',
  Leg: 'Chặng',
  Legs: 'Các chặng',
  'Distance (km)': 'Cự ly (km)',
  'Route on the map': 'Tuyến trên bản đồ',
  'Rolling start': 'Xuất phát cuốn chiếu',
  'Typical rate': 'Tốc độ trung bình',
  Unit: 'Đơn vị',

  // — race format —
  'Single sport': 'Một môn',
  Triathlon: 'Ba môn phối hợp',
  Duathlon: 'Hai môn (chạy - đạp)',
  Aquathlon: 'Hai môn (bơi - chạy)',
  Swim: 'Bơi',
  Bike: 'Đạp',
  Run: 'Chạy',
  Transition: 'Chuyển tiếp',

  // — settings —
  'Setup buffer (min)': 'Thời gian dựng trạm (phút)',
  'Teardown buffer (min)': 'Thời gian dỡ trạm (phút)',
  'Cut-off grace (min)': 'Biên độ COT (phút)',
  'Histogram bin (min)': 'Khung thống kê (phút)',

  // — amenities —
  Water: 'Nước',
  Medical: 'Y tế',
  Electrolyte: 'Điện giải',
  Banana: 'Chuối',
  Watermelon: 'Dưa hấu',
  'Ice bucket': 'Thùng đá',
  'Porta toilet': 'Nhà vệ sinh di động',
  Ambulance: 'Xe cứu thương',
  'On course': 'Trên đường đua',
  'start/finish': 'xuất phát/về đích',

  // — hint paragraphs —
  'Only the folders you tick get scheduled. Cut-off times are still read from the whole map, so a station that shares a spot with a cut-off point keeps that closing time even when the cut-off folder is unticked.':
    'Chỉ những lớp bạn chọn mới được lên lịch. Thời gian giới hạn vẫn được đọc từ toàn bộ bản đồ, nên một trạm trùng vị trí với điểm COT vẫn giữ giờ đóng đó dù lớp COT không được chọn.',
  'Activity tags come from the busiest counting window at each station, the same figure the schedule and the report show. A mass-start road race and a trail race with a rolling start need very different numbers.':
    'Mức độ được xác định từ khung cao điểm của từng trạm, đúng con số mà lịch vận hành và báo cáo hiển thị. Giải đường nhựa xuất phát đồng loạt và giải trail xuất phát cuốn chiếu cần con số rất khác nhau.',
  'Medium at': 'Trung bình từ',
  'High at': 'Cao từ',
  'Runners through in the busiest window before a station is tagged Medium':
    'Số VĐV qua trạm trong khung cao điểm để được gắn nhãn Trung bình',
  'Runners through in the busiest window before a station is tagged High':
    'Số VĐV qua trạm trong khung cao điểm để được gắn nhãn Cao',
  'One report in two finishes. The dark one keeps the brand theme, for reading on a screen or hosting behind a link; the print one is the same content ink-on-white for paper and email. Both are single self-contained files that open offline.':
    'Một báo cáo, hai kiểu trình bày. Bản nền tối giữ nhận diện thương hiệu, để xem trên màn hình hoặc chia sẻ qua link; bản in cùng nội dung nhưng nền trắng, dùng để in và gửi email. Cả hai đều là file độc lập, mở được khi không có mạng.',
  "Every point each distance runs through, with the kilometre it falls at on that distance's own route and the hours the position is staffed.":
    'Mọi điểm mà từng cự ly đi qua, kèm số km trên tuyến của chính cự ly đó và khung giờ trạm phải có người.',
  'The points a runner meets in order, with the gap from the previous one and what each one stocks — the view for spacing water and aid.':
    'Các điểm VĐV gặp theo thứ tự, kèm khoảng cách từ điểm trước và những gì mỗi điểm có — dùng để bố trí nước và vật phẩm.',
  'One station at a time, with every figure printed on the bar — the page a crew works from. Distances stand side by side rather than stacked, so each race can be counted on its own.':
    'Từng trạm một, mọi con số in ngay trên cột — trang mà đội trạm dùng để làm việc. Các cự ly đứng cạnh nhau thay vì chồng lên nhau, để đếm riêng từng cự ly.',
  'All rows share one height scale, so bar heights are comparable between stations. Quiet stations look flat because they genuinely see fewer runners.':
    'Mọi hàng dùng chung một thang chiều cao, nên có thể so sánh giữa các trạm. Trạm vắng trông thấp vì thực sự ít VĐV đi qua.',
  'Each row is scaled to its own busiest window — the shape of each station’s load is readable, but heights are no longer comparable between stations.':
    'Mỗi hàng được chia thang theo khung cao điểm của chính nó — dễ đọc hình dạng tải của từng trạm, nhưng không so sánh chiều cao giữa các trạm được nữa.',

  'Proposed from the slowest modelled runner plus {n} minutes, then rounded up. Rounding up rather than to nearest keeps a cut-off from landing earlier than the calculation intended.':
    'Đề xuất từ VĐV chậm nhất theo mô hình cộng thêm {n} phút, rồi làm tròn lên. Làm tròn lên thay vì làm tròn gần nhất giúp COT không rơi sớm hơn kết quả tính toán.',

  'set by you': 'bạn tự đặt',
  'measured from pace': 'đo từ pace',
  'from the name — check': 'lấy từ tên — cần kiểm tra',
  'from split labels': 'từ nhãn split',
  'guessed from times': 'suy từ thời gian',
  'unknown — set it': 'chưa rõ — hãy đặt',

  'Minutes over which the whole field crosses the start line':
    'Số phút để toàn bộ VĐV vượt qua vạch xuất phát',
  'Pace of the leading runners, in minutes per km': 'Pace của nhóm dẫn đầu, phút mỗi km',
  'Median runner pace, in minutes per km': 'Pace trung vị, phút mỗi km',
  'Pace of the final finishers, in minutes per km': 'Pace của nhóm về cuối, phút mỗi km',
  'Paces are minutes per km. Fastest and slowest anchor the P1 and P99 arrivals; spread is how long the field takes to clear the start line. COT is the finish cut-off the organizer has set for that distance — leave it blank if it has not been provided yet, and the tool proposes one instead.':
    'Pace tính theo phút mỗi km. Nhanh nhất và chậm nhất neo mốc P1 và P99; độ giãn là thời gian để toàn bộ VĐV rời vạch xuất phát. COT là giới hạn về đích ban tổ chức đặt cho cự ly đó — để trống nếu chưa có, công cụ sẽ tự đề xuất.',

  // — misc —
  Note: 'Ghi chú',
  Order: 'Sắp xếp',
  'Opens earliest first': 'Mở sớm nhất trước',
  'Closes latest first': 'Đóng muộn nhất trước',
  'Longest open first': 'Mở lâu nhất trước',
  'from results file': 'từ file kết quả',
  longest: 'dài nhất',
  'on course': 'trên đường đua',
  'Peak {n}-min window': 'Khung cao điểm {n} phút',
  'First Male / Female, coloured by distance': 'Nam / Nữ đầu tiên, màu theo cự ly',
  'Skip points whose name contains': 'Bỏ qua điểm có tên chứa',
  'Number stations along the course': 'Đánh số trạm dọc đường đua',
  'Choose an exported KML from Google My Maps, with each CP type on its own layer. Race routes can live in a layer here too, or come from the route files below.':
    'Chọn file KML xuất từ Google My Maps, mỗi loại trạm ở một lớp riêng. Tuyến đường đua có thể nằm trong một lớp ở đây, hoặc lấy từ file GPX bên dưới.',

  'Remove this contest': 'Xoá cự ly này',
  'from the map is covered by': 'từ bản đồ đã được thay bằng',
  'from GPX, which carries elevation.': 'từ file GPX, vì file này có dữ liệu độ cao.',

  'Optional. Supply the timing configuration and every station takes the name the timing system uses, so nothing needs renaming on the map.':
    'Không bắt buộc. Nếu có file cấu hình bấm giờ, mọi trạm sẽ tự lấy tên theo hệ thống bấm giờ, không cần sửa tên trên bản đồ.',

  // Hand-added distances and copying names.
  'Add a distance': 'Thêm một cự ly',
  'For a wave, a relay or a category racing a course the files already hold.':
    'Dùng cho một wave, một đội tiếp sức hay một hạng mục chạy trên đường đua đã có sẵn.',
  'Remove this distance': 'Xoá cự ly này',
  'Use RACERESULT names for all': 'Dùng tên RACERESULT cho tất cả',
  'Renames every matched station to the column it produces in the results file.':
    'Đổi tên mọi trạm đã khớp thành đúng tên cột trong file kết quả.',

  // The course profile as a command view.
  'stations on course': 'trạm trên đường đua',
  'The climbs and the crews on one picture. Timed stations are solid and named; the ones with no mat are hollow — a chip is read at the first and not the second.':
    'Dốc và nhân sự trên cùng một hình. Trạm có bấm giờ hiện đậm và có tên; trạm không có thảm hiện rỗng — chip chỉ được đọc ở loại thứ nhất.',
  'Drop the route GPX for a distance to see its profile here, with every station drawn on it.':
    'Kéo thả file GPX của một cự ly để xem trắc dọc kèm toàn bộ trạm trên đó.',
  Course: 'Cự ly',
  'Stations on course': 'Số trạm',
  'elevation profile with stations': 'trắc dọc kèm các trạm',
  'no timing mat': 'không có thảm bấm giờ',
  'Timed — a chip is read here': 'Có bấm giờ — chip được đọc ở đây',
  'No mat — staffed, but nobody is counted': 'Không có thảm — vẫn có nhân sự, nhưng không ai được đếm',

  // The field on the course.
  'Where the field is': 'VĐV đang ở đâu',
  'When each distance starts': 'Giờ xuất phát của từng cự ly',
  m: 'm',
  'Slide to a moment and see every distance on the course at once, under the climbs they are on and beside the stations that serve them.':
    'Kéo tới một thời điểm để thấy toàn bộ các cự ly trên đường đua cùng lúc, kèm địa hình và các trạm phục vụ.',
  'Drop the route GPX for the longest distance to see the field on its course.':
    'Kéo thả file GPX của cự ly dài nhất để xem VĐV trên đường đua.',
  At: 'Lúc',
  'Runners on course': 'Đang trên đường',
  'Busiest kilometre': 'Km đông nhất',
  'Off this course': 'Ngoài tuyến này',
  'Running ground the longest course never touches': 'Đang chạy trên đoạn mà cự ly dài nhất không đi qua',
  'The field on the course at the chosen moment': 'VĐV trên đường đua tại thời điểm đã chọn',
  runners: 'VĐV',
  'Back an hour': 'Lùi một giờ',
  'On an hour': 'Tiến một giờ',
  'Moment of the race': 'Thời điểm trong giải',
  'Every distance placed on the longest course. Counts between two timing mats are exact — a chip read at one and not the other puts a runner between them — but where on that stretch they are is interpolated.':
    'Mọi cự ly được đặt trên cự ly dài nhất. Số VĐV giữa hai thảm bấm giờ là số chính xác — chip đọc ở thảm này mà chưa đọc ở thảm kia nghĩa là VĐV đang ở giữa — nhưng vị trí cụ thể trong đoạn đó là số nội suy.',

  // Multi-day races.
  'Race date': 'Ngày thi đấu',
  'The first day of the event — every time is then named by its weekday':
    'Ngày đầu tiên của sự kiện — mọi mốc giờ sẽ được gọi theo thứ trong tuần',
  'Times on later days are named by their weekday.':
    'Các mốc giờ sang ngày sau sẽ hiện kèm thứ trong tuần.',
  'Optional. Without it, later days are counted as D+1, D+2.':
    'Không bắt buộc. Nếu bỏ trống, các ngày sau được đánh số D+1, D+2.',
  'Start day': 'Ngày xuất phát',
  'COT day': 'Ngày COT',
  'Which day of the event this distance starts on': 'Cự ly này xuất phát vào ngày nào của sự kiện',
  'Which day the cut-off falls on — an ultra finishes on another day':
    'COT rơi vào ngày nào — giải ultra về đích sang ngày khác',
  'Which day the cut-off falls on': 'COT rơi vào ngày nào',

  // Station naming review.
  'Station naming': 'Đặt tên trạm',
  timed: 'có bấm giờ',
  Timed: 'Có bấm giờ',
  'Name on the map': 'Tên trên bản đồ',
  Match: 'Độ khớp',
  'No stations to review.': 'Chưa có trạm nào để rà soát.',
  'Plan only the stations with a timing mat': 'Chỉ lập kế hoạch cho trạm có thảm bấm giờ',
  'stations have a mat. Only these carry through — untick one and it leaves every section below.':
    'trạm có thảm bấm giờ. Chỉ những trạm này được đưa vào kế hoạch — bỏ tick là trạm đó rời khỏi mọi mục bên dưới.',
  'stations have a mat. Every station is being planned, timed or not.':
    'trạm có thảm bấm giờ. Mọi trạm đều đang được lập kế hoạch, dù có bấm giờ hay không.',
  'Names come from the timing configuration where a mat was found within reach of the pin, and can be typed over. A match measured further than 0.8 km is flagged for a second look.':
    'Tên lấy từ cấu hình bấm giờ khi tìm được thảm gần điểm trên bản đồ, và có thể gõ đè lên. Dòng lệch quá 0,8 km sẽ được đánh dấu để rà lại.',

  // Timing split configuration.
  'Timing points': 'Điểm bấm giờ',
  'Drop the timing split files (.lvs) here, or': 'Kéo thả file cấu hình bấm giờ (.lvs) vào đây, hoặc',
  'One per distance, exported from the timing program. Stations take their names from these.':
    'Mỗi cự ly một file, xuất từ phần mềm bấm giờ. Tên trạm sẽ lấy từ đây.',
  'timing points': 'điểm bấm giờ',
  'no matching course loaded': 'chưa có đường đua tương ứng',
  'Name in RACERESULT': 'Tên trong RACERESULT',
  'Declared km': 'Km công bố',
  Mat: 'Thảm',
  backup: 'dự phòng',

  // Route files and their profiles.
  'Course profile': 'Độ cao đường đua',
  'Drop the route GPX for each distance to read its climbing. A GPX carries elevation on every point; a KML usually loses it.':
    'Kéo thả file GPX của từng cự ly để đọc độ leo. File GPX có độ cao ở mọi điểm; file KML thường mất dữ liệu này.',
  'Drop route GPX files here, or': 'Kéo thả file GPX đường đua vào đây, hoặc',
  'One file per distance is fine — drop them all at once.':
    'Mỗi cự ly một file cũng được — kéo tất cả vào cùng lúc.',
  Unreadable: 'Không đọc được',
  points: 'điểm',
  Climb: 'Tổng leo',
  Descent: 'Tổng xuống',
  Range: 'Khoảng cao độ',
  'Flat-equivalent': 'Quy đổi đường bằng',
  'Biggest climbs': 'Các dốc lớn nhất',
  Length: 'Chiều dài',
  Gradient: 'Độ dốc',
  'elevation profile': 'trắc dọc độ cao',
  'This file has no elevation, so it can describe the route but not the climbing.':
    'File này không có dữ liệu độ cao, nên chỉ mô tả được tuyến đường chứ không tính được độ leo.',
  'Elevation is missing from part of this file': 'File này thiếu độ cao ở một phần dữ liệu',
  'of points have none, so no profile is drawn.':
    'số điểm không có độ cao, nên không vẽ được trắc dọc.',
  'Recorded track — smoothed at': 'Track ghi từ thiết bị — đã làm mượt ở mức',
  'before totalling': 'trước khi cộng tổng',
  'reverses direction': 'đổi chiều',
  'of the time': 'số lần',
  'Already filtered by whatever wrote the file — totalled as it stands':
    'Đã được lọc sẵn bởi phần mềm tạo file — cộng tổng nguyên trạng',
  'Drop a race KML here, or': 'Kéo thả file KML vào đây, hoặc',
  browse: 'chọn file',
  'Choose the layer that contains the type of CP you want to calculate.':
    'Chọn lớp chứa loại trạm bạn muốn tính toán.',
  final: 'cuối',
  tighter: 'chặt hơn',
  pass: 'lượt',
  of: 'trên',
  'No arrivals': 'Không có VĐV',
  'no arrivals': 'không có VĐV',
  visits: 'lượt qua',
  busiest: 'cao điểm',
  stations: 'trạm',
  'stations, one page each': 'trạm, mỗi trạm một trang',
  'Every point, by distance': 'Mọi điểm, theo cự ly',
  'The race day on one clock': 'Cả ngày đua trên một trục thời gian',
  distances: 'cự ly',
  proposals: 'đề xuất',
};

const DICTIONARIES: Record<Lang, Record<string, string>> = { en: {}, vi: VI };

/** Translates, falling back to the English key so nothing renders as a blank. */
export type Translate = (english: string) => string;

interface LanguageValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Translate;
}

const LanguageContext = createContext<LanguageValue>({
  lang: 'en',
  setLang: () => {},
  t: (english) => english,
});

function storedLang(): Lang {
  if (typeof localStorage === 'undefined') return 'en';
  return localStorage.getItem(STORAGE_KEY) === 'vi' ? 'vi' : 'en';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(storedLang);

  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const t = useCallback<Translate>((english) => DICTIONARIES[lang][english] ?? english, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageValue {
  return useContext(LanguageContext);
}

/** The common case: a component only wants to translate. */
export function useT(): Translate {
  return useContext(LanguageContext).t;
}

/** Everything the dictionary answers to, for a test that checks nothing is orphaned. */
export function translationKeys(lang: Lang): string[] {
  return Object.keys(DICTIONARIES[lang]);
}

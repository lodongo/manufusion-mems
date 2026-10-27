/** ISIC Rev.5 economic activity structure. Official code hierarchy (22 / 87 / 258 / 463).
 * Labels/codes extracted from a public reproduction of UNSD ISIC Rev.5; no unofficial explanatory notes copied.
 * Verify against UNSD errata on updates: https://unstats.un.org/unsd/classifications/Econ/isic
 * Section code is an uppercase letter, division/group/class codes are official numeric strings.
 */
export type IsicLevel = 'Section'|'Division'|'Group'|'Class';
export type IsicEntry = {level:IsicLevel;code:string;section:string;name:string;parentCode:string};
export const ISIC_REV5_ENTRIES: readonly IsicEntry[] = [
 {
  "level": "Section",
  "code": "A",
  "section": "A",
  "name": "Agriculture, forestry and fishing",
  "parentCode": ""
 },
 {
  "level": "Section",
  "code": "B",
  "section": "B",
  "name": "Mining and quarrying",
  "parentCode": ""
 },
 {
  "level": "Section",
  "code": "C",
  "section": "C",
  "name": "Manufacturing",
  "parentCode": ""
 },
 {
  "level": "Section",
  "code": "D",
  "section": "D",
  "name": "Electricity, gas, steam and air conditioning supply",
  "parentCode": ""
 },
 {
  "level": "Section",
  "code": "E",
  "section": "E",
  "name": "Water supply; sewerage, waste management and remediation activities",
  "parentCode": ""
 },
 {
  "level": "Section",
  "code": "F",
  "section": "F",
  "name": "Construction",
  "parentCode": ""
 },
 {
  "level": "Section",
  "code": "G",
  "section": "G",
  "name": "Wholesale and retail trade",
  "parentCode": ""
 },
 {
  "level": "Section",
  "code": "H",
  "section": "H",
  "name": "Transportation and storage",
  "parentCode": ""
 },
 {
  "level": "Section",
  "code": "I",
  "section": "I",
  "name": "Accommodation and food service activities",
  "parentCode": ""
 },
 {
  "level": "Section",
  "code": "J",
  "section": "J",
  "name": "Publishing, broadcasting, and content production and distribution activities",
  "parentCode": ""
 },
 {
  "level": "Section",
  "code": "K",
  "section": "K",
  "name": "Telecommunications, computer programming, consultancy, computing infrastructure, and other information service activities",
  "parentCode": ""
 },
 {
  "level": "Section",
  "code": "L",
  "section": "L",
  "name": "Financial and insurance activities",
  "parentCode": ""
 },
 {
  "level": "Section",
  "code": "M",
  "section": "M",
  "name": "Real estate activities",
  "parentCode": ""
 },
 {
  "level": "Section",
  "code": "N",
  "section": "N",
  "name": "Professional, scientific and technical activities",
  "parentCode": ""
 },
 {
  "level": "Section",
  "code": "O",
  "section": "O",
  "name": "Administrative and support service activities",
  "parentCode": ""
 },
 {
  "level": "Section",
  "code": "P",
  "section": "P",
  "name": "Public administration and defence; compulsory social security",
  "parentCode": ""
 },
 {
  "level": "Section",
  "code": "Q",
  "section": "Q",
  "name": "Education",
  "parentCode": ""
 },
 {
  "level": "Section",
  "code": "R",
  "section": "R",
  "name": "Human health and social work activities",
  "parentCode": ""
 },
 {
  "level": "Section",
  "code": "S",
  "section": "S",
  "name": "Arts, sports and recreation",
  "parentCode": ""
 },
 {
  "level": "Section",
  "code": "T",
  "section": "T",
  "name": "Other service activities",
  "parentCode": ""
 },
 {
  "level": "Section",
  "code": "U",
  "section": "U",
  "name": "Activities of households as employers; undifferentiated goods- and services-producing activities of households for own use",
  "parentCode": ""
 },
 {
  "level": "Section",
  "code": "V",
  "section": "V",
  "name": "Activities of extraterritorial organizations and bodies",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "01",
  "section": "A",
  "name": "Crop and animal production, hunting and related service activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "02",
  "section": "A",
  "name": "Forestry and logging",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "03",
  "section": "A",
  "name": "Fishing and aquaculture",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "05",
  "section": "B",
  "name": "Mining of coal and lignite",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "06",
  "section": "B",
  "name": "Extraction of crude petroleum and natural gas",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "07",
  "section": "B",
  "name": "Mining of metal ores",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "08",
  "section": "B",
  "name": "Other mining and quarrying",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "09",
  "section": "B",
  "name": "Mining support service activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "10",
  "section": "C",
  "name": "Manufacture of food products",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "11",
  "section": "C",
  "name": "Manufacture of beverages",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "12",
  "section": "C",
  "name": "Manufacture of tobacco products",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "13",
  "section": "C",
  "name": "Manufacture of textiles",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "14",
  "section": "C",
  "name": "Manufacture of wearing apparel",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "15",
  "section": "C",
  "name": "Manufacture of leather and related products",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "16",
  "section": "C",
  "name": "Manufacture of wood and of products of wood and cork, except furniture; manufacture of articles of straw and plaiting materials",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "17",
  "section": "C",
  "name": "Manufacture of paper and paper products",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "18",
  "section": "C",
  "name": "Printing and reproduction of recorded media",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "19",
  "section": "C",
  "name": "Manufacture of coke and refined petroleum products",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "20",
  "section": "C",
  "name": "Manufacture of chemicals and chemical products",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "21",
  "section": "C",
  "name": "Manufacture of basic pharmaceutical products and pharmaceutical preparations",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "22",
  "section": "C",
  "name": "Manufacture of rubber and plastic products",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "23",
  "section": "C",
  "name": "Manufacture of other non-metallic mineral products",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "24",
  "section": "C",
  "name": "Manufacture of basic metals",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "25",
  "section": "C",
  "name": "Manufacture of fabricated metal products, except machinery and equipment",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "26",
  "section": "C",
  "name": "Manufacture of computer, electronic and optical products",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "27",
  "section": "C",
  "name": "Manufacture of electrical equipment",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "28",
  "section": "C",
  "name": "Manufacture of machinery and equipment n.e.c.",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "29",
  "section": "C",
  "name": "Manufacture of motor vehicles, trailers and semi-trailers",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "30",
  "section": "C",
  "name": "Manufacture of other transport equipment",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "31",
  "section": "C",
  "name": "Manufacture of furniture",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "32",
  "section": "C",
  "name": "Other manufacturing",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "33",
  "section": "C",
  "name": "Repair, maintenance and installation of machinery and equipment",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "35",
  "section": "D",
  "name": "Electricity, gas, steam and air conditioning supply",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "36",
  "section": "E",
  "name": "Water collection, treatment and supply",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "37",
  "section": "E",
  "name": "Sewerage",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "38",
  "section": "E",
  "name": "Waste collection, treatment and disposal, and recovery activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "39",
  "section": "E",
  "name": "Remediation and other waste management service activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "41",
  "section": "F",
  "name": "Construction of residential and non-residential buildings",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "42",
  "section": "F",
  "name": "Civil engineering",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "43",
  "section": "F",
  "name": "Specialized construction activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "46",
  "section": "G",
  "name": "Wholesale trade",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "47",
  "section": "G",
  "name": "Retail trade",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "49",
  "section": "H",
  "name": "Land transport and transport via pipelines",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "50",
  "section": "H",
  "name": "Water transport",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "51",
  "section": "H",
  "name": "Air transport",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "52",
  "section": "H",
  "name": "Warehousing and support activities for transportation",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "53",
  "section": "H",
  "name": "Postal and courier activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "55",
  "section": "I",
  "name": "Accommodation",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "56",
  "section": "I",
  "name": "Food and beverage service activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "58",
  "section": "J",
  "name": "Publishing activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "59",
  "section": "J",
  "name": "Motion picture, video and television programme production, sound recording and music publishing activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "60",
  "section": "J",
  "name": "Programming, broadcasting, news agency and other content distribution activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "61",
  "section": "K",
  "name": "Telecommunications",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "62",
  "section": "K",
  "name": "Computer programming, consultancy and related activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "63",
  "section": "K",
  "name": "Computing infrastructure, data processing, hosting, and other information service activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "64",
  "section": "L",
  "name": "Financial service activities, except insurance and pension funding",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "65",
  "section": "L",
  "name": "Insurance, reinsurance and pension funding, except compulsory social security",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "66",
  "section": "L",
  "name": "Activities auxiliary to financial service and insurance activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "68",
  "section": "M",
  "name": "Real estate activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "69",
  "section": "N",
  "name": "Legal and accounting activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "70",
  "section": "N",
  "name": "Activities of head offices; management consultancy activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "71",
  "section": "N",
  "name": "Architectural and engineering activities; technical testing and analysis",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "72",
  "section": "N",
  "name": "Scientific research and development",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "73",
  "section": "N",
  "name": "Activities of advertising, market research and public relations",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "74",
  "section": "N",
  "name": "Other professional, scientific and technical activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "75",
  "section": "N",
  "name": "Veterinary activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "77",
  "section": "O",
  "name": "Rental and leasing activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "78",
  "section": "O",
  "name": "Employment activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "79",
  "section": "O",
  "name": "Travel agency, tour operator, and other travel related activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "80",
  "section": "O",
  "name": "Investigation and security activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "81",
  "section": "O",
  "name": "Services to buildings and landscape activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "82",
  "section": "O",
  "name": "Office administrative, office support and other business support activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "84",
  "section": "P",
  "name": "Public administration and defence; compulsory social security",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "85",
  "section": "Q",
  "name": "Education",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "86",
  "section": "R",
  "name": "Human health activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "87",
  "section": "R",
  "name": "Residential care activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "88",
  "section": "R",
  "name": "Social work activities without accommodation",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "90",
  "section": "S",
  "name": "Arts creation and performing arts activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "91",
  "section": "S",
  "name": "Library, archives, museum and other cultural activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "92",
  "section": "S",
  "name": "Gambling and betting activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "93",
  "section": "S",
  "name": "Sports activities and amusement and recreation activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "94",
  "section": "T",
  "name": "Activities of membership organizations",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "95",
  "section": "T",
  "name": "Repair and maintenance of computers, personal and household goods, and motor vehicles and motorcycles",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "96",
  "section": "T",
  "name": "Personal service activities",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "97",
  "section": "U",
  "name": "Activities of households as employers of domestic personnel",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "98",
  "section": "U",
  "name": "Undifferentiated goods- and services-producing activities of private households for own use",
  "parentCode": ""
 },
 {
  "level": "Division",
  "code": "99",
  "section": "V",
  "name": "Activities of extraterritorial organizations and bodies",
  "parentCode": ""
 },
 {
  "level": "Group",
  "code": "011",
  "section": "A",
  "name": "Growing of non-perennial crops",
  "parentCode": "01"
 },
 {
  "level": "Group",
  "code": "012",
  "section": "A",
  "name": "Growing of perennial crops",
  "parentCode": "01"
 },
 {
  "level": "Group",
  "code": "013",
  "section": "A",
  "name": "Plant propagation",
  "parentCode": "01"
 },
 {
  "level": "Group",
  "code": "014",
  "section": "A",
  "name": "Animal production",
  "parentCode": "01"
 },
 {
  "level": "Group",
  "code": "015",
  "section": "A",
  "name": "Mixed farming",
  "parentCode": "01"
 },
 {
  "level": "Group",
  "code": "016",
  "section": "A",
  "name": "Support activities to agriculture and post-harvest crop activities",
  "parentCode": "01"
 },
 {
  "level": "Group",
  "code": "017",
  "section": "A",
  "name": "Hunting, trapping and related service activities",
  "parentCode": "01"
 },
 {
  "level": "Group",
  "code": "021",
  "section": "A",
  "name": "Silviculture and other forestry activities",
  "parentCode": "02"
 },
 {
  "level": "Group",
  "code": "022",
  "section": "A",
  "name": "Logging",
  "parentCode": "02"
 },
 {
  "level": "Group",
  "code": "023",
  "section": "A",
  "name": "Gathering of non-wood forest products",
  "parentCode": "02"
 },
 {
  "level": "Group",
  "code": "024",
  "section": "A",
  "name": "Support services to forestry",
  "parentCode": "02"
 },
 {
  "level": "Group",
  "code": "031",
  "section": "A",
  "name": "Fishing",
  "parentCode": "03"
 },
 {
  "level": "Group",
  "code": "032",
  "section": "A",
  "name": "Aquaculture",
  "parentCode": "03"
 },
 {
  "level": "Group",
  "code": "033",
  "section": "A",
  "name": "Support activities for fishing and aquaculture",
  "parentCode": "03"
 },
 {
  "level": "Group",
  "code": "051",
  "section": "B",
  "name": "Mining of hard coal",
  "parentCode": "05"
 },
 {
  "level": "Group",
  "code": "052",
  "section": "B",
  "name": "Mining of lignite",
  "parentCode": "05"
 },
 {
  "level": "Group",
  "code": "061",
  "section": "B",
  "name": "Extraction of crude petroleum",
  "parentCode": "06"
 },
 {
  "level": "Group",
  "code": "062",
  "section": "B",
  "name": "Extraction of natural gas",
  "parentCode": "06"
 },
 {
  "level": "Group",
  "code": "071",
  "section": "B",
  "name": "Mining of iron ores",
  "parentCode": "07"
 },
 {
  "level": "Group",
  "code": "072",
  "section": "B",
  "name": "Mining of non-ferrous metal ores",
  "parentCode": "07"
 },
 {
  "level": "Group",
  "code": "081",
  "section": "B",
  "name": "Quarrying of stone, sand and clay",
  "parentCode": "08"
 },
 {
  "level": "Group",
  "code": "089",
  "section": "B",
  "name": "Mining and quarrying n.e.c.",
  "parentCode": "08"
 },
 {
  "level": "Group",
  "code": "091",
  "section": "B",
  "name": "Support activities for petroleum and natural gas extraction",
  "parentCode": "09"
 },
 {
  "level": "Group",
  "code": "099",
  "section": "B",
  "name": "Support activities for other mining and quarrying",
  "parentCode": "09"
 },
 {
  "level": "Group",
  "code": "101",
  "section": "C",
  "name": "Processing and preserving of meat",
  "parentCode": "10"
 },
 {
  "level": "Group",
  "code": "102",
  "section": "C",
  "name": "Processing and preserving of fish, crustaceans and molluscs",
  "parentCode": "10"
 },
 {
  "level": "Group",
  "code": "103",
  "section": "C",
  "name": "Processing and preserving of fruit and vegetables",
  "parentCode": "10"
 },
 {
  "level": "Group",
  "code": "104",
  "section": "C",
  "name": "Manufacture of vegetable and animal oils and fats",
  "parentCode": "10"
 },
 {
  "level": "Group",
  "code": "105",
  "section": "C",
  "name": "Manufacture of dairy products",
  "parentCode": "10"
 },
 {
  "level": "Group",
  "code": "106",
  "section": "C",
  "name": "Manufacture of grain mill products, starches and starch products",
  "parentCode": "10"
 },
 {
  "level": "Group",
  "code": "107",
  "section": "C",
  "name": "Manufacture of other food products",
  "parentCode": "10"
 },
 {
  "level": "Group",
  "code": "108",
  "section": "C",
  "name": "Manufacture of prepared animal feeds",
  "parentCode": "10"
 },
 {
  "level": "Group",
  "code": "110",
  "section": "C",
  "name": "Manufacture of beverages",
  "parentCode": "11"
 },
 {
  "level": "Group",
  "code": "120",
  "section": "C",
  "name": "Manufacture of tobacco products",
  "parentCode": "12"
 },
 {
  "level": "Group",
  "code": "131",
  "section": "C",
  "name": "Spinning, weaving and finishing of textiles",
  "parentCode": "13"
 },
 {
  "level": "Group",
  "code": "139",
  "section": "C",
  "name": "Manufacture of other textiles",
  "parentCode": "13"
 },
 {
  "level": "Group",
  "code": "141",
  "section": "C",
  "name": "Manufacture of wearing apparel, except fur apparel",
  "parentCode": "14"
 },
 {
  "level": "Group",
  "code": "142",
  "section": "C",
  "name": "Manufacture of articles of fur",
  "parentCode": "14"
 },
 {
  "level": "Group",
  "code": "143",
  "section": "C",
  "name": "Manufacture of knitted and crocheted apparel",
  "parentCode": "14"
 },
 {
  "level": "Group",
  "code": "151",
  "section": "C",
  "name": "Tanning, dyeing, dressing of leather and fur; manufacture of luggage, handbags, saddlery and harness",
  "parentCode": "15"
 },
 {
  "level": "Group",
  "code": "152",
  "section": "C",
  "name": "Manufacture of footwear",
  "parentCode": "15"
 },
 {
  "level": "Group",
  "code": "161",
  "section": "C",
  "name": "Sawmilling and planing of wood",
  "parentCode": "16"
 },
 {
  "level": "Group",
  "code": "162",
  "section": "C",
  "name": "Manufacture of products of wood, cork, straw and plaiting materials",
  "parentCode": "16"
 },
 {
  "level": "Group",
  "code": "170",
  "section": "C",
  "name": "Manufacture of paper and paper products",
  "parentCode": "17"
 },
 {
  "level": "Group",
  "code": "181",
  "section": "C",
  "name": "Printing and service activities related to printing",
  "parentCode": "18"
 },
 {
  "level": "Group",
  "code": "182",
  "section": "C",
  "name": "Reproduction of recorded media",
  "parentCode": "18"
 },
 {
  "level": "Group",
  "code": "191",
  "section": "C",
  "name": "Manufacture of coke oven products",
  "parentCode": "19"
 },
 {
  "level": "Group",
  "code": "192",
  "section": "C",
  "name": "Manufacture of refined petroleum products; manufacture of fossil fuel products",
  "parentCode": "19"
 },
 {
  "level": "Group",
  "code": "201",
  "section": "C",
  "name": "Manufacture of basic chemicals, fertilizers and nitrogen compounds, plastics and synthetic rubber in primary forms",
  "parentCode": "20"
 },
 {
  "level": "Group",
  "code": "202",
  "section": "C",
  "name": "Manufacture of other chemical products",
  "parentCode": "20"
 },
 {
  "level": "Group",
  "code": "203",
  "section": "C",
  "name": "Manufacture of man-made fibres",
  "parentCode": "20"
 },
 {
  "level": "Group",
  "code": "210",
  "section": "C",
  "name": "Manufacture of pharmaceuticals, medicinal chemical and botanical products",
  "parentCode": "21"
 },
 {
  "level": "Group",
  "code": "221",
  "section": "C",
  "name": "Manufacture of rubber products",
  "parentCode": "22"
 },
 {
  "level": "Group",
  "code": "222",
  "section": "C",
  "name": "Manufacture of plastics products",
  "parentCode": "22"
 },
 {
  "level": "Group",
  "code": "231",
  "section": "C",
  "name": "Manufacture of glass and glass products",
  "parentCode": "23"
 },
 {
  "level": "Group",
  "code": "239",
  "section": "C",
  "name": "Manufacture of non-metallic mineral products n.e.c.",
  "parentCode": "23"
 },
 {
  "level": "Group",
  "code": "241",
  "section": "C",
  "name": "Manufacture of basic iron and steel",
  "parentCode": "24"
 },
 {
  "level": "Group",
  "code": "242",
  "section": "C",
  "name": "Manufacture of basic precious and other non-ferrous metals",
  "parentCode": "24"
 },
 {
  "level": "Group",
  "code": "243",
  "section": "C",
  "name": "Casting of metals",
  "parentCode": "24"
 },
 {
  "level": "Group",
  "code": "251",
  "section": "C",
  "name": "Manufacture of structural metal products, tanks, reservoirs and steam generators",
  "parentCode": "25"
 },
 {
  "level": "Group",
  "code": "252",
  "section": "C",
  "name": "Manufacture of weapons and ammunition",
  "parentCode": "25"
 },
 {
  "level": "Group",
  "code": "259",
  "section": "C",
  "name": "Manufacture of other fabricated metal products; metalworking service activities",
  "parentCode": "25"
 },
 {
  "level": "Group",
  "code": "261",
  "section": "C",
  "name": "Manufacture of electronic components and boards",
  "parentCode": "26"
 },
 {
  "level": "Group",
  "code": "262",
  "section": "C",
  "name": "Manufacture of computers and peripheral equipment",
  "parentCode": "26"
 },
 {
  "level": "Group",
  "code": "263",
  "section": "C",
  "name": "Manufacture of communication equipment",
  "parentCode": "26"
 },
 {
  "level": "Group",
  "code": "264",
  "section": "C",
  "name": "Manufacture of consumer electronics",
  "parentCode": "26"
 },
 {
  "level": "Group",
  "code": "265",
  "section": "C",
  "name": "Manufacture of measuring, testing, navigating and control equipment; watches and clocks",
  "parentCode": "26"
 },
 {
  "level": "Group",
  "code": "266",
  "section": "C",
  "name": "Manufacture of irradiation, electromedical and electrotherapeutic equipment",
  "parentCode": "26"
 },
 {
  "level": "Group",
  "code": "267",
  "section": "C",
  "name": "Manufacture of optical instruments and photographic equipment",
  "parentCode": "26"
 },
 {
  "level": "Group",
  "code": "268",
  "section": "C",
  "name": "Manufacture of magnetic and optical media",
  "parentCode": "26"
 },
 {
  "level": "Group",
  "code": "271",
  "section": "C",
  "name": "Manufacture of electric motors, generators, transformers and electricity distribution and control apparatus",
  "parentCode": "27"
 },
 {
  "level": "Group",
  "code": "272",
  "section": "C",
  "name": "Manufacture of batteries and accumulators",
  "parentCode": "27"
 },
 {
  "level": "Group",
  "code": "273",
  "section": "C",
  "name": "Manufacture of wiring and wiring devices",
  "parentCode": "27"
 },
 {
  "level": "Group",
  "code": "274",
  "section": "C",
  "name": "Manufacture of lighting equipment",
  "parentCode": "27"
 },
 {
  "level": "Group",
  "code": "275",
  "section": "C",
  "name": "Manufacture of domestic appliances",
  "parentCode": "27"
 },
 {
  "level": "Group",
  "code": "279",
  "section": "C",
  "name": "Manufacture of other electrical equipment",
  "parentCode": "27"
 },
 {
  "level": "Group",
  "code": "281",
  "section": "C",
  "name": "Manufacture of general-purpose machinery",
  "parentCode": "28"
 },
 {
  "level": "Group",
  "code": "282",
  "section": "C",
  "name": "Manufacture of special-purpose machinery",
  "parentCode": "28"
 },
 {
  "level": "Group",
  "code": "291",
  "section": "C",
  "name": "Manufacture of motor vehicles",
  "parentCode": "29"
 },
 {
  "level": "Group",
  "code": "292",
  "section": "C",
  "name": "Manufacture of bodies (coachwork) for motor vehicles; manufacture of trailers and semi-trailers",
  "parentCode": "29"
 },
 {
  "level": "Group",
  "code": "293",
  "section": "C",
  "name": "Manufacture of parts and accessories for motor vehicles",
  "parentCode": "29"
 },
 {
  "level": "Group",
  "code": "301",
  "section": "C",
  "name": "Building of ships and boats",
  "parentCode": "30"
 },
 {
  "level": "Group",
  "code": "302",
  "section": "C",
  "name": "Manufacture of railway locomotives and rolling stock",
  "parentCode": "30"
 },
 {
  "level": "Group",
  "code": "303",
  "section": "C",
  "name": "Manufacture of air and spacecraft and related machinery",
  "parentCode": "30"
 },
 {
  "level": "Group",
  "code": "304",
  "section": "C",
  "name": "Manufacture of military fighting vehicles",
  "parentCode": "30"
 },
 {
  "level": "Group",
  "code": "309",
  "section": "C",
  "name": "Manufacture of transport equipment n.e.c.",
  "parentCode": "30"
 },
 {
  "level": "Group",
  "code": "310",
  "section": "C",
  "name": "Manufacture of furniture",
  "parentCode": "31"
 },
 {
  "level": "Group",
  "code": "321",
  "section": "C",
  "name": "Manufacture of jewellery, bijouterie and related articles",
  "parentCode": "32"
 },
 {
  "level": "Group",
  "code": "322",
  "section": "C",
  "name": "Manufacture of musical instruments",
  "parentCode": "32"
 },
 {
  "level": "Group",
  "code": "323",
  "section": "C",
  "name": "Manufacture of sports goods",
  "parentCode": "32"
 },
 {
  "level": "Group",
  "code": "324",
  "section": "C",
  "name": "Manufacture of games and toys",
  "parentCode": "32"
 },
 {
  "level": "Group",
  "code": "325",
  "section": "C",
  "name": "Manufacture of medical and dental instruments and supplies",
  "parentCode": "32"
 },
 {
  "level": "Group",
  "code": "329",
  "section": "C",
  "name": "Other manufacturing n.e.c.",
  "parentCode": "32"
 },
 {
  "level": "Group",
  "code": "331",
  "section": "C",
  "name": "Repair and maintenance of fabricated metal products, machinery and equipment",
  "parentCode": "33"
 },
 {
  "level": "Group",
  "code": "332",
  "section": "C",
  "name": "Installation of industrial machinery and equipment",
  "parentCode": "33"
 },
 {
  "level": "Group",
  "code": "351",
  "section": "D",
  "name": "Electric power generation, transmission and distribution activities",
  "parentCode": "35"
 },
 {
  "level": "Group",
  "code": "352",
  "section": "D",
  "name": "Manufacture of gas; distribution of gaseous fuels through mains",
  "parentCode": "35"
 },
 {
  "level": "Group",
  "code": "353",
  "section": "D",
  "name": "Steam and air conditioning supply",
  "parentCode": "35"
 },
 {
  "level": "Group",
  "code": "354",
  "section": "D",
  "name": "Activities of brokers and agents for electric power and natural gas",
  "parentCode": "35"
 },
 {
  "level": "Group",
  "code": "360",
  "section": "E",
  "name": "Water collection, treatment and supply",
  "parentCode": "36"
 },
 {
  "level": "Group",
  "code": "370",
  "section": "E",
  "name": "Sewerage",
  "parentCode": "37"
 },
 {
  "level": "Group",
  "code": "381",
  "section": "E",
  "name": "Waste collection activities",
  "parentCode": "38"
 },
 {
  "level": "Group",
  "code": "382",
  "section": "E",
  "name": "Waste treatment and disposal",
  "parentCode": "38"
 },
 {
  "level": "Group",
  "code": "383",
  "section": "E",
  "name": "Materials and other waste recovery",
  "parentCode": "38"
 },
 {
  "level": "Group",
  "code": "390",
  "section": "E",
  "name": "Remediation and other waste management service activities",
  "parentCode": "39"
 },
 {
  "level": "Group",
  "code": "410",
  "section": "F",
  "name": "Construction of residential and non-residential buildings",
  "parentCode": "41"
 },
 {
  "level": "Group",
  "code": "421",
  "section": "F",
  "name": "Construction of roads and railways",
  "parentCode": "42"
 },
 {
  "level": "Group",
  "code": "422",
  "section": "F",
  "name": "Construction of utility projects",
  "parentCode": "42"
 },
 {
  "level": "Group",
  "code": "429",
  "section": "F",
  "name": "Construction of other civil engineering projects",
  "parentCode": "42"
 },
 {
  "level": "Group",
  "code": "431",
  "section": "F",
  "name": "Demolition and site preparation",
  "parentCode": "43"
 },
 {
  "level": "Group",
  "code": "432",
  "section": "F",
  "name": "Electrical, plumbing and other construction installation activities",
  "parentCode": "43"
 },
 {
  "level": "Group",
  "code": "433",
  "section": "F",
  "name": "Building completion and finishing",
  "parentCode": "43"
 },
 {
  "level": "Group",
  "code": "434",
  "section": "F",
  "name": "Intermediation service activities for specialized construction services",
  "parentCode": "43"
 },
 {
  "level": "Group",
  "code": "439",
  "section": "F",
  "name": "Other specialized construction activities",
  "parentCode": "43"
 },
 {
  "level": "Group",
  "code": "461",
  "section": "G",
  "name": "Wholesale on a fee or contract basis",
  "parentCode": "46"
 },
 {
  "level": "Group",
  "code": "462",
  "section": "G",
  "name": "Wholesale of agricultural raw materials and live animals",
  "parentCode": "46"
 },
 {
  "level": "Group",
  "code": "463",
  "section": "G",
  "name": "Wholesale of food, beverages and tobacco",
  "parentCode": "46"
 },
 {
  "level": "Group",
  "code": "464",
  "section": "G",
  "name": "Wholesale of household goods",
  "parentCode": "46"
 },
 {
  "level": "Group",
  "code": "465",
  "section": "G",
  "name": "Wholesale of machinery, equipment and supplies",
  "parentCode": "46"
 },
 {
  "level": "Group",
  "code": "466",
  "section": "G",
  "name": "Wholesale of motor vehicles, motorcycles and related parts and accessories",
  "parentCode": "46"
 },
 {
  "level": "Group",
  "code": "467",
  "section": "G",
  "name": "Other specialized wholesale",
  "parentCode": "46"
 },
 {
  "level": "Group",
  "code": "469",
  "section": "G",
  "name": "Non-specialized wholesale trade",
  "parentCode": "46"
 },
 {
  "level": "Group",
  "code": "471",
  "section": "G",
  "name": "Non-specialized retail sale",
  "parentCode": "47"
 },
 {
  "level": "Group",
  "code": "472",
  "section": "G",
  "name": "Retail sale of food, beverages and tobacco",
  "parentCode": "47"
 },
 {
  "level": "Group",
  "code": "473",
  "section": "G",
  "name": "Retail sale of automotive fuel",
  "parentCode": "47"
 },
 {
  "level": "Group",
  "code": "474",
  "section": "G",
  "name": "Retail sale of information and communication equipment",
  "parentCode": "47"
 },
 {
  "level": "Group",
  "code": "475",
  "section": "G",
  "name": "Retail sale of other household equipment",
  "parentCode": "47"
 },
 {
  "level": "Group",
  "code": "476",
  "section": "G",
  "name": "Retail sale of cultural and recreational goods",
  "parentCode": "47"
 },
 {
  "level": "Group",
  "code": "477",
  "section": "G",
  "name": "Retail sale of other goods, except motor vehicles and motorcycles",
  "parentCode": "47"
 },
 {
  "level": "Group",
  "code": "478",
  "section": "G",
  "name": "Retail sale of motor vehicles, motorcycles and related parts and accessories",
  "parentCode": "47"
 },
 {
  "level": "Group",
  "code": "479",
  "section": "G",
  "name": "Intermediation service activities for retail sale",
  "parentCode": "47"
 },
 {
  "level": "Group",
  "code": "491",
  "section": "H",
  "name": "Transport via railways",
  "parentCode": "49"
 },
 {
  "level": "Group",
  "code": "492",
  "section": "H",
  "name": "Other land transport",
  "parentCode": "49"
 },
 {
  "level": "Group",
  "code": "493",
  "section": "H",
  "name": "Transport via pipeline",
  "parentCode": "49"
 },
 {
  "level": "Group",
  "code": "501",
  "section": "H",
  "name": "Sea and coastal water transport",
  "parentCode": "50"
 },
 {
  "level": "Group",
  "code": "502",
  "section": "H",
  "name": "Inland water transport",
  "parentCode": "50"
 },
 {
  "level": "Group",
  "code": "511",
  "section": "H",
  "name": "Passenger air transport",
  "parentCode": "51"
 },
 {
  "level": "Group",
  "code": "512",
  "section": "H",
  "name": "Freight air transport",
  "parentCode": "51"
 },
 {
  "level": "Group",
  "code": "521",
  "section": "H",
  "name": "Warehousing and storage",
  "parentCode": "52"
 },
 {
  "level": "Group",
  "code": "522",
  "section": "H",
  "name": "Support activities for transportation",
  "parentCode": "52"
 },
 {
  "level": "Group",
  "code": "523",
  "section": "H",
  "name": "Intermediation service activities for transportation",
  "parentCode": "52"
 },
 {
  "level": "Group",
  "code": "531",
  "section": "H",
  "name": "Postal activities",
  "parentCode": "53"
 },
 {
  "level": "Group",
  "code": "532",
  "section": "H",
  "name": "Courier activities",
  "parentCode": "53"
 },
 {
  "level": "Group",
  "code": "533",
  "section": "H",
  "name": "Intermediation service activities for postal and courier activities",
  "parentCode": "53"
 },
 {
  "level": "Group",
  "code": "551",
  "section": "I",
  "name": "Hotels and similar accommodation activities",
  "parentCode": "55"
 },
 {
  "level": "Group",
  "code": "552",
  "section": "I",
  "name": "Other short term accommodation activities",
  "parentCode": "55"
 },
 {
  "level": "Group",
  "code": "553",
  "section": "I",
  "name": "Camping grounds, recreational vehicle parks and trailer parks",
  "parentCode": "55"
 },
 {
  "level": "Group",
  "code": "554",
  "section": "I",
  "name": "Intermediation service activities for accommodation",
  "parentCode": "55"
 },
 {
  "level": "Group",
  "code": "559",
  "section": "I",
  "name": "Other accommodation n.e.c.",
  "parentCode": "55"
 },
 {
  "level": "Group",
  "code": "561",
  "section": "I",
  "name": "Restaurants and mobile food service activities",
  "parentCode": "56"
 },
 {
  "level": "Group",
  "code": "562",
  "section": "I",
  "name": "Event catering and other food service activities",
  "parentCode": "56"
 },
 {
  "level": "Group",
  "code": "563",
  "section": "I",
  "name": "Beverage serving activities",
  "parentCode": "56"
 },
 {
  "level": "Group",
  "code": "564",
  "section": "I",
  "name": "Intermediation service activities for food and beverage services activities",
  "parentCode": "56"
 },
 {
  "level": "Group",
  "code": "581",
  "section": "J",
  "name": "Publishing of books, newspapers, periodicals and other publishing activities",
  "parentCode": "58"
 },
 {
  "level": "Group",
  "code": "582",
  "section": "J",
  "name": "Software publishing",
  "parentCode": "58"
 },
 {
  "level": "Group",
  "code": "591",
  "section": "J",
  "name": "Motion picture, video and television programme activities",
  "parentCode": "59"
 },
 {
  "level": "Group",
  "code": "592",
  "section": "J",
  "name": "Sound recording and music publishing activities",
  "parentCode": "59"
 },
 {
  "level": "Group",
  "code": "601",
  "section": "J",
  "name": "Radio broadcasting and audio distribution activities",
  "parentCode": "60"
 },
 {
  "level": "Group",
  "code": "602",
  "section": "J",
  "name": "Television programming, broadcasting and video distribution activities",
  "parentCode": "60"
 },
 {
  "level": "Group",
  "code": "603",
  "section": "J",
  "name": "News agency and other content distribution activities",
  "parentCode": "60"
 },
 {
  "level": "Group",
  "code": "611",
  "section": "K",
  "name": "Wired, wireless, and satellite telecommunication activities",
  "parentCode": "61"
 },
 {
  "level": "Group",
  "code": "612",
  "section": "K",
  "name": "Telecommunication reselling activities and intermediation service activities for telecommunication",
  "parentCode": "61"
 },
 {
  "level": "Group",
  "code": "619",
  "section": "K",
  "name": "Other telecommunication activities",
  "parentCode": "61"
 },
 {
  "level": "Group",
  "code": "621",
  "section": "K",
  "name": "Computer programming activities",
  "parentCode": "62"
 },
 {
  "level": "Group",
  "code": "622",
  "section": "K",
  "name": "Computer consultancy and computer facilities management activities",
  "parentCode": "62"
 },
 {
  "level": "Group",
  "code": "629",
  "section": "K",
  "name": "Other information technology and computer service activities",
  "parentCode": "62"
 },
 {
  "level": "Group",
  "code": "631",
  "section": "K",
  "name": "Computing infrastructure, data processing, hosting and related activities",
  "parentCode": "63"
 },
 {
  "level": "Group",
  "code": "639",
  "section": "K",
  "name": "Web search portals activities and other information service activities",
  "parentCode": "63"
 },
 {
  "level": "Group",
  "code": "641",
  "section": "L",
  "name": "Monetary intermediation",
  "parentCode": "64"
 },
 {
  "level": "Group",
  "code": "642",
  "section": "L",
  "name": "Activities of holding companies and financing conduits",
  "parentCode": "64"
 },
 {
  "level": "Group",
  "code": "643",
  "section": "L",
  "name": "Activities of trusts, funds and similar financial entities",
  "parentCode": "64"
 },
 {
  "level": "Group",
  "code": "649",
  "section": "L",
  "name": "Other financial service activities, except insurance and pension funding activities",
  "parentCode": "64"
 },
 {
  "level": "Group",
  "code": "651",
  "section": "L",
  "name": "Insurance",
  "parentCode": "65"
 },
 {
  "level": "Group",
  "code": "652",
  "section": "L",
  "name": "Reinsurance",
  "parentCode": "65"
 },
 {
  "level": "Group",
  "code": "653",
  "section": "L",
  "name": "Pension funding",
  "parentCode": "65"
 },
 {
  "level": "Group",
  "code": "661",
  "section": "L",
  "name": "Activities auxiliary to financial services, except insurance and pension funding",
  "parentCode": "66"
 },
 {
  "level": "Group",
  "code": "662",
  "section": "L",
  "name": "Activities auxiliary to insurance and pension funding",
  "parentCode": "66"
 },
 {
  "level": "Group",
  "code": "663",
  "section": "L",
  "name": "Fund management activities",
  "parentCode": "66"
 },
 {
  "level": "Group",
  "code": "681",
  "section": "M",
  "name": "Real estate activities with own or leased property",
  "parentCode": "68"
 },
 {
  "level": "Group",
  "code": "682",
  "section": "M",
  "name": "Real estate activities on a fee or contract basis",
  "parentCode": "68"
 },
 {
  "level": "Group",
  "code": "691",
  "section": "N",
  "name": "Legal activities",
  "parentCode": "69"
 },
 {
  "level": "Group",
  "code": "692",
  "section": "N",
  "name": "Accounting, bookkeeping and auditing activities; tax consultancy",
  "parentCode": "69"
 },
 {
  "level": "Group",
  "code": "701",
  "section": "N",
  "name": "Activities of head offices",
  "parentCode": "70"
 },
 {
  "level": "Group",
  "code": "702",
  "section": "N",
  "name": "Business and other management consultancy activities",
  "parentCode": "70"
 },
 {
  "level": "Group",
  "code": "711",
  "section": "N",
  "name": "Architectural and engineering, and related technical consultancy activities",
  "parentCode": "71"
 },
 {
  "level": "Group",
  "code": "712",
  "section": "N",
  "name": "Technical testing and analysis",
  "parentCode": "71"
 },
 {
  "level": "Group",
  "code": "721",
  "section": "N",
  "name": "Research and experimental development on natural sciences and engineering",
  "parentCode": "72"
 },
 {
  "level": "Group",
  "code": "722",
  "section": "N",
  "name": "Research and experimental development on social sciences and humanities",
  "parentCode": "72"
 },
 {
  "level": "Group",
  "code": "731",
  "section": "N",
  "name": "Advertising activities",
  "parentCode": "73"
 },
 {
  "level": "Group",
  "code": "732",
  "section": "N",
  "name": "Market research and public opinion polling activities",
  "parentCode": "73"
 },
 {
  "level": "Group",
  "code": "733",
  "section": "N",
  "name": "Public relations activities",
  "parentCode": "73"
 },
 {
  "level": "Group",
  "code": "741",
  "section": "N",
  "name": "Specialized design activities",
  "parentCode": "74"
 },
 {
  "level": "Group",
  "code": "742",
  "section": "N",
  "name": "Photographic activities",
  "parentCode": "74"
 },
 {
  "level": "Group",
  "code": "743",
  "section": "N",
  "name": "Translation and interpretation activities",
  "parentCode": "74"
 },
 {
  "level": "Group",
  "code": "749",
  "section": "N",
  "name": "Other professional, scientific and technical activities n.e.c.",
  "parentCode": "74"
 },
 {
  "level": "Group",
  "code": "750",
  "section": "N",
  "name": "Veterinary activities",
  "parentCode": "75"
 },
 {
  "level": "Group",
  "code": "771",
  "section": "O",
  "name": "Rental and leasing of motor vehicles",
  "parentCode": "77"
 },
 {
  "level": "Group",
  "code": "772",
  "section": "O",
  "name": "Rental and leasing of personal and household goods",
  "parentCode": "77"
 },
 {
  "level": "Group",
  "code": "773",
  "section": "O",
  "name": "Rental and leasing of other machinery, equipment and tangible goods",
  "parentCode": "77"
 },
 {
  "level": "Group",
  "code": "774",
  "section": "O",
  "name": "Leasing of intellectual property and similar products, except copyrighted works",
  "parentCode": "77"
 },
 {
  "level": "Group",
  "code": "775",
  "section": "O",
  "name": "Intermediation service activities for rental and leasing of tangible goods and non-financial intangible assets",
  "parentCode": "77"
 },
 {
  "level": "Group",
  "code": "781",
  "section": "O",
  "name": "Activities of employment placement agencies",
  "parentCode": "78"
 },
 {
  "level": "Group",
  "code": "782",
  "section": "O",
  "name": "Temporary employment agency activities and other human resource provisions",
  "parentCode": "78"
 },
 {
  "level": "Group",
  "code": "791",
  "section": "O",
  "name": "Travel agency and tour operator activities",
  "parentCode": "79"
 },
 {
  "level": "Group",
  "code": "799",
  "section": "O",
  "name": "Other travel related activities",
  "parentCode": "79"
 },
 {
  "level": "Group",
  "code": "801",
  "section": "O",
  "name": "Investigation and security activities",
  "parentCode": "80"
 },
 {
  "level": "Group",
  "code": "811",
  "section": "O",
  "name": "Combined facilities support activities",
  "parentCode": "81"
 },
 {
  "level": "Group",
  "code": "812",
  "section": "O",
  "name": "Cleaning activities",
  "parentCode": "81"
 },
 {
  "level": "Group",
  "code": "813",
  "section": "O",
  "name": "Landscape service activities",
  "parentCode": "81"
 },
 {
  "level": "Group",
  "code": "821",
  "section": "O",
  "name": "Office administrative and support activities",
  "parentCode": "82"
 },
 {
  "level": "Group",
  "code": "822",
  "section": "O",
  "name": "Activities of call centres",
  "parentCode": "82"
 },
 {
  "level": "Group",
  "code": "823",
  "section": "O",
  "name": "Organization of conventions and trade shows",
  "parentCode": "82"
 },
 {
  "level": "Group",
  "code": "824",
  "section": "O",
  "name": "Intermediation service activities for business support activities n.e.c., except financial intermediation",
  "parentCode": "82"
 },
 {
  "level": "Group",
  "code": "829",
  "section": "O",
  "name": "Business support service activities n.e.c.",
  "parentCode": "82"
 },
 {
  "level": "Group",
  "code": "841",
  "section": "P",
  "name": "Administration of the State and the economic, social and environmental policies of the community",
  "parentCode": "84"
 },
 {
  "level": "Group",
  "code": "842",
  "section": "P",
  "name": "Provision of services to the community as a whole",
  "parentCode": "84"
 },
 {
  "level": "Group",
  "code": "843",
  "section": "P",
  "name": "Compulsory social security activities",
  "parentCode": "84"
 },
 {
  "level": "Group",
  "code": "851",
  "section": "Q",
  "name": "Pre-primary education",
  "parentCode": "85"
 },
 {
  "level": "Group",
  "code": "852",
  "section": "Q",
  "name": "Primary education",
  "parentCode": "85"
 },
 {
  "level": "Group",
  "code": "853",
  "section": "Q",
  "name": "Secondary and post-secondary non-tertiary education",
  "parentCode": "85"
 },
 {
  "level": "Group",
  "code": "854",
  "section": "Q",
  "name": "Tertiary education",
  "parentCode": "85"
 },
 {
  "level": "Group",
  "code": "855",
  "section": "Q",
  "name": "Other education",
  "parentCode": "85"
 },
 {
  "level": "Group",
  "code": "856",
  "section": "Q",
  "name": "Educational support activities",
  "parentCode": "85"
 },
 {
  "level": "Group",
  "code": "861",
  "section": "R",
  "name": "Hospital activities",
  "parentCode": "86"
 },
 {
  "level": "Group",
  "code": "862",
  "section": "R",
  "name": "Medical and dental practice activities",
  "parentCode": "86"
 },
 {
  "level": "Group",
  "code": "869",
  "section": "R",
  "name": "Other human health activities",
  "parentCode": "86"
 },
 {
  "level": "Group",
  "code": "871",
  "section": "R",
  "name": "Residential nursing care activities",
  "parentCode": "87"
 },
 {
  "level": "Group",
  "code": "872",
  "section": "R",
  "name": "Residential care activities for persons living with or having a diagnosis of a mental illness or substance abuse",
  "parentCode": "87"
 },
 {
  "level": "Group",
  "code": "873",
  "section": "R",
  "name": "Residential care activities for older persons or persons with physical disabilities",
  "parentCode": "87"
 },
 {
  "level": "Group",
  "code": "879",
  "section": "R",
  "name": "Other residential care activities",
  "parentCode": "87"
 },
 {
  "level": "Group",
  "code": "881",
  "section": "R",
  "name": "Social work activities without accommodation for older persons or persons with disabilities",
  "parentCode": "88"
 },
 {
  "level": "Group",
  "code": "889",
  "section": "R",
  "name": "Other social work activities without accommodation",
  "parentCode": "88"
 },
 {
  "level": "Group",
  "code": "901",
  "section": "S",
  "name": "Arts creation activities",
  "parentCode": "90"
 },
 {
  "level": "Group",
  "code": "902",
  "section": "S",
  "name": "Activities of performing arts",
  "parentCode": "90"
 },
 {
  "level": "Group",
  "code": "903",
  "section": "S",
  "name": "Support activities to arts creation and performing arts",
  "parentCode": "90"
 },
 {
  "level": "Group",
  "code": "911",
  "section": "S",
  "name": "Library and archive activities",
  "parentCode": "91"
 },
 {
  "level": "Group",
  "code": "912",
  "section": "S",
  "name": "Museum, collection, historical site and monument activities",
  "parentCode": "91"
 },
 {
  "level": "Group",
  "code": "913",
  "section": "S",
  "name": "Conservation, restoration and other support activities for cultural heritage",
  "parentCode": "91"
 },
 {
  "level": "Group",
  "code": "914",
  "section": "S",
  "name": "Botanical and zoological garden and nature reserve activities",
  "parentCode": "91"
 },
 {
  "level": "Group",
  "code": "920",
  "section": "S",
  "name": "Gambling and betting activities",
  "parentCode": "92"
 },
 {
  "level": "Group",
  "code": "931",
  "section": "S",
  "name": "Sports activities",
  "parentCode": "93"
 },
 {
  "level": "Group",
  "code": "932",
  "section": "S",
  "name": "Amusement and recreation activities",
  "parentCode": "93"
 },
 {
  "level": "Group",
  "code": "941",
  "section": "T",
  "name": "Activities of business, employers and professional membership organizations",
  "parentCode": "94"
 },
 {
  "level": "Group",
  "code": "942",
  "section": "T",
  "name": "Activities of trade unions",
  "parentCode": "94"
 },
 {
  "level": "Group",
  "code": "949",
  "section": "T",
  "name": "Activities of other membership organizations",
  "parentCode": "94"
 },
 {
  "level": "Group",
  "code": "951",
  "section": "T",
  "name": "Repair and maintenance of computers and communication equipment",
  "parentCode": "95"
 },
 {
  "level": "Group",
  "code": "952",
  "section": "T",
  "name": "Repair and maintenance of personal and household goods",
  "parentCode": "95"
 },
 {
  "level": "Group",
  "code": "953",
  "section": "T",
  "name": "Repair and maintenance of motor vehicles and motorcycles",
  "parentCode": "95"
 },
 {
  "level": "Group",
  "code": "954",
  "section": "T",
  "name": "Intermediation service activities for repair and maintenance of computers, personal and household goods, and motor vehicles and motorcycles",
  "parentCode": "95"
 },
 {
  "level": "Group",
  "code": "961",
  "section": "T",
  "name": "Washing and cleaning of textile and fur products",
  "parentCode": "96"
 },
 {
  "level": "Group",
  "code": "962",
  "section": "T",
  "name": "Hairdressing, beauty treatment, day spa and similar activities",
  "parentCode": "96"
 },
 {
  "level": "Group",
  "code": "963",
  "section": "T",
  "name": "Funeral and related activities",
  "parentCode": "96"
 },
 {
  "level": "Group",
  "code": "964",
  "section": "T",
  "name": "Intermediation service activities for personal services",
  "parentCode": "96"
 },
 {
  "level": "Group",
  "code": "969",
  "section": "T",
  "name": "Other personal service activities n.e.c.",
  "parentCode": "96"
 },
 {
  "level": "Group",
  "code": "970",
  "section": "U",
  "name": "Activities of households as employers of domestic personnel",
  "parentCode": "97"
 },
 {
  "level": "Group",
  "code": "981",
  "section": "U",
  "name": "Undifferentiated goods-producing activities of private households for own use",
  "parentCode": "98"
 },
 {
  "level": "Group",
  "code": "982",
  "section": "U",
  "name": "Undifferentiated service-producing activities of private households for own use",
  "parentCode": "98"
 },
 {
  "level": "Group",
  "code": "990",
  "section": "V",
  "name": "Activities of extraterritorial organizations and bodies",
  "parentCode": "99"
 },
 {
  "level": "Class",
  "code": "0111",
  "section": "A",
  "name": "Growing of cereals (except rice), leguminous crops and oil seeds",
  "parentCode": "011"
 },
 {
  "level": "Class",
  "code": "0112",
  "section": "A",
  "name": "Growing of rice",
  "parentCode": "011"
 },
 {
  "level": "Class",
  "code": "0113",
  "section": "A",
  "name": "Growing of vegetables and melons, roots and tubers",
  "parentCode": "011"
 },
 {
  "level": "Class",
  "code": "0114",
  "section": "A",
  "name": "Growing of sugar cane",
  "parentCode": "011"
 },
 {
  "level": "Class",
  "code": "0115",
  "section": "A",
  "name": "Growing of tobacco",
  "parentCode": "011"
 },
 {
  "level": "Class",
  "code": "0116",
  "section": "A",
  "name": "Growing of fibre crops",
  "parentCode": "011"
 },
 {
  "level": "Class",
  "code": "0119",
  "section": "A",
  "name": "Growing of other non-perennial crops",
  "parentCode": "011"
 },
 {
  "level": "Class",
  "code": "0121",
  "section": "A",
  "name": "Growing of grapes",
  "parentCode": "012"
 },
 {
  "level": "Class",
  "code": "0122",
  "section": "A",
  "name": "Growing of tropical and subtropical fruits",
  "parentCode": "012"
 },
 {
  "level": "Class",
  "code": "0123",
  "section": "A",
  "name": "Growing of citrus fruits",
  "parentCode": "012"
 },
 {
  "level": "Class",
  "code": "0124",
  "section": "A",
  "name": "Growing of pome fruits and stone fruits",
  "parentCode": "012"
 },
 {
  "level": "Class",
  "code": "0125",
  "section": "A",
  "name": "Growing of other tree and bush fruits and nuts",
  "parentCode": "012"
 },
 {
  "level": "Class",
  "code": "0126",
  "section": "A",
  "name": "Growing of oleaginous fruits",
  "parentCode": "012"
 },
 {
  "level": "Class",
  "code": "0127",
  "section": "A",
  "name": "Growing of beverage crops",
  "parentCode": "012"
 },
 {
  "level": "Class",
  "code": "0128",
  "section": "A",
  "name": "Growing of spices, aromatic, drug and pharmaceutical crops",
  "parentCode": "012"
 },
 {
  "level": "Class",
  "code": "0129",
  "section": "A",
  "name": "Growing of other perennial crops",
  "parentCode": "012"
 },
 {
  "level": "Class",
  "code": "0130",
  "section": "A",
  "name": "Plant propagation",
  "parentCode": "013"
 },
 {
  "level": "Class",
  "code": "0141",
  "section": "A",
  "name": "Raising of cattle and buffaloes",
  "parentCode": "014"
 },
 {
  "level": "Class",
  "code": "0142",
  "section": "A",
  "name": "Raising of horses and other equines",
  "parentCode": "014"
 },
 {
  "level": "Class",
  "code": "0143",
  "section": "A",
  "name": "Raising of camels and camelids",
  "parentCode": "014"
 },
 {
  "level": "Class",
  "code": "0144",
  "section": "A",
  "name": "Raising of sheep and goats",
  "parentCode": "014"
 },
 {
  "level": "Class",
  "code": "0145",
  "section": "A",
  "name": "Raising of swine and pigs",
  "parentCode": "014"
 },
 {
  "level": "Class",
  "code": "0146",
  "section": "A",
  "name": "Raising of poultry",
  "parentCode": "014"
 },
 {
  "level": "Class",
  "code": "0149",
  "section": "A",
  "name": "Raising of other animals",
  "parentCode": "014"
 },
 {
  "level": "Class",
  "code": "0150",
  "section": "A",
  "name": "Mixed farming",
  "parentCode": "015"
 },
 {
  "level": "Class",
  "code": "0161",
  "section": "A",
  "name": "Support activities for crop production",
  "parentCode": "016"
 },
 {
  "level": "Class",
  "code": "0162",
  "section": "A",
  "name": "Support activities for animal production",
  "parentCode": "016"
 },
 {
  "level": "Class",
  "code": "0163",
  "section": "A",
  "name": "Post-harvest crop activities",
  "parentCode": "016"
 },
 {
  "level": "Class",
  "code": "0164",
  "section": "A",
  "name": "Seed processing for propagation",
  "parentCode": "016"
 },
 {
  "level": "Class",
  "code": "0170",
  "section": "A",
  "name": "Hunting, trapping and related service activities",
  "parentCode": "017"
 },
 {
  "level": "Class",
  "code": "0210",
  "section": "A",
  "name": "Silviculture and other forestry activities",
  "parentCode": "021"
 },
 {
  "level": "Class",
  "code": "0220",
  "section": "A",
  "name": "Logging",
  "parentCode": "022"
 },
 {
  "level": "Class",
  "code": "0230",
  "section": "A",
  "name": "Gathering of non-wood forest products",
  "parentCode": "023"
 },
 {
  "level": "Class",
  "code": "0240",
  "section": "A",
  "name": "Support services to forestry",
  "parentCode": "024"
 },
 {
  "level": "Class",
  "code": "0311",
  "section": "A",
  "name": "Marine fishing",
  "parentCode": "031"
 },
 {
  "level": "Class",
  "code": "0312",
  "section": "A",
  "name": "Freshwater fishing",
  "parentCode": "031"
 },
 {
  "level": "Class",
  "code": "0321",
  "section": "A",
  "name": "Marine aquaculture",
  "parentCode": "032"
 },
 {
  "level": "Class",
  "code": "0322",
  "section": "A",
  "name": "Freshwater aquaculture",
  "parentCode": "032"
 },
 {
  "level": "Class",
  "code": "0330",
  "section": "A",
  "name": "Support activities for fishing and aquaculture",
  "parentCode": "033"
 },
 {
  "level": "Class",
  "code": "0510",
  "section": "B",
  "name": "Mining of hard coal",
  "parentCode": "051"
 },
 {
  "level": "Class",
  "code": "0520",
  "section": "B",
  "name": "Mining of lignite",
  "parentCode": "052"
 },
 {
  "level": "Class",
  "code": "0610",
  "section": "B",
  "name": "Extraction of crude petroleum",
  "parentCode": "061"
 },
 {
  "level": "Class",
  "code": "0620",
  "section": "B",
  "name": "Extraction of natural gas",
  "parentCode": "062"
 },
 {
  "level": "Class",
  "code": "0710",
  "section": "B",
  "name": "Mining of iron ores",
  "parentCode": "071"
 },
 {
  "level": "Class",
  "code": "0721",
  "section": "B",
  "name": "Mining of uranium and thorium ores",
  "parentCode": "072"
 },
 {
  "level": "Class",
  "code": "0729",
  "section": "B",
  "name": "Mining of other non-ferrous metal ores",
  "parentCode": "072"
 },
 {
  "level": "Class",
  "code": "0810",
  "section": "B",
  "name": "Quarrying of stone, sand and clay",
  "parentCode": "081"
 },
 {
  "level": "Class",
  "code": "0891",
  "section": "B",
  "name": "Mining of chemical and fertilizer minerals",
  "parentCode": "089"
 },
 {
  "level": "Class",
  "code": "0892",
  "section": "B",
  "name": "Extraction of peat",
  "parentCode": "089"
 },
 {
  "level": "Class",
  "code": "0893",
  "section": "B",
  "name": "Extraction of salt",
  "parentCode": "089"
 },
 {
  "level": "Class",
  "code": "0899",
  "section": "B",
  "name": "Other mining and quarrying n.e.c.",
  "parentCode": "089"
 },
 {
  "level": "Class",
  "code": "0910",
  "section": "B",
  "name": "Support activities for petroleum and natural gas extraction",
  "parentCode": "091"
 },
 {
  "level": "Class",
  "code": "0990",
  "section": "B",
  "name": "Support activities for other mining and quarrying",
  "parentCode": "099"
 },
 {
  "level": "Class",
  "code": "1010",
  "section": "C",
  "name": "Processing and preserving of meat",
  "parentCode": "101"
 },
 {
  "level": "Class",
  "code": "1020",
  "section": "C",
  "name": "Processing and preserving of fish, crustaceans and molluscs",
  "parentCode": "102"
 },
 {
  "level": "Class",
  "code": "1030",
  "section": "C",
  "name": "Processing and preserving of fruit and vegetables",
  "parentCode": "103"
 },
 {
  "level": "Class",
  "code": "1040",
  "section": "C",
  "name": "Manufacture of vegetable and animal oils and fats",
  "parentCode": "104"
 },
 {
  "level": "Class",
  "code": "1050",
  "section": "C",
  "name": "Manufacture of dairy products",
  "parentCode": "105"
 },
 {
  "level": "Class",
  "code": "1061",
  "section": "C",
  "name": "Manufacture of grain mill products",
  "parentCode": "106"
 },
 {
  "level": "Class",
  "code": "1062",
  "section": "C",
  "name": "Manufacture of starches and starch products",
  "parentCode": "106"
 },
 {
  "level": "Class",
  "code": "1071",
  "section": "C",
  "name": "Manufacture of bakery products",
  "parentCode": "107"
 },
 {
  "level": "Class",
  "code": "1072",
  "section": "C",
  "name": "Manufacture of sugar",
  "parentCode": "107"
 },
 {
  "level": "Class",
  "code": "1073",
  "section": "C",
  "name": "Manufacture of cocoa, chocolate and sugar confectionery",
  "parentCode": "107"
 },
 {
  "level": "Class",
  "code": "1074",
  "section": "C",
  "name": "Manufacture of macaroni, noodles, couscous and similar farinaceous products",
  "parentCode": "107"
 },
 {
  "level": "Class",
  "code": "1075",
  "section": "C",
  "name": "Manufacture of prepared meals and dishes",
  "parentCode": "107"
 },
 {
  "level": "Class",
  "code": "1076",
  "section": "C",
  "name": "Processing of coffee and tea",
  "parentCode": "107"
 },
 {
  "level": "Class",
  "code": "1079",
  "section": "C",
  "name": "Manufacture of other food products n.e.c.",
  "parentCode": "107"
 },
 {
  "level": "Class",
  "code": "1080",
  "section": "C",
  "name": "Manufacture of prepared animal feeds",
  "parentCode": "108"
 },
 {
  "level": "Class",
  "code": "1101",
  "section": "C",
  "name": "Distilling, rectifying and blending of spirits",
  "parentCode": "110"
 },
 {
  "level": "Class",
  "code": "1102",
  "section": "C",
  "name": "Manufacture of wines",
  "parentCode": "110"
 },
 {
  "level": "Class",
  "code": "1103",
  "section": "C",
  "name": "Manufacture of beer",
  "parentCode": "110"
 },
 {
  "level": "Class",
  "code": "1104",
  "section": "C",
  "name": "Manufacture of malt",
  "parentCode": "110"
 },
 {
  "level": "Class",
  "code": "1105",
  "section": "C",
  "name": "Manufacture of soft drinks; production of mineral waters and other bottled waters",
  "parentCode": "110"
 },
 {
  "level": "Class",
  "code": "1200",
  "section": "C",
  "name": "Manufacture of tobacco products",
  "parentCode": "120"
 },
 {
  "level": "Class",
  "code": "1311",
  "section": "C",
  "name": "Preparation and spinning of textile fibres",
  "parentCode": "131"
 },
 {
  "level": "Class",
  "code": "1312",
  "section": "C",
  "name": "Weaving of textiles",
  "parentCode": "131"
 },
 {
  "level": "Class",
  "code": "1313",
  "section": "C",
  "name": "Finishing of textiles",
  "parentCode": "131"
 },
 {
  "level": "Class",
  "code": "1391",
  "section": "C",
  "name": "Manufacture of knitted and crocheted fabrics",
  "parentCode": "139"
 },
 {
  "level": "Class",
  "code": "1392",
  "section": "C",
  "name": "Manufacture of made-up textile articles, except apparel",
  "parentCode": "139"
 },
 {
  "level": "Class",
  "code": "1393",
  "section": "C",
  "name": "Manufacture of carpets and rugs",
  "parentCode": "139"
 },
 {
  "level": "Class",
  "code": "1394",
  "section": "C",
  "name": "Manufacture of cordage, rope, twine and netting",
  "parentCode": "139"
 },
 {
  "level": "Class",
  "code": "1399",
  "section": "C",
  "name": "Manufacture of other textiles n.e.c.",
  "parentCode": "139"
 },
 {
  "level": "Class",
  "code": "1410",
  "section": "C",
  "name": "Manufacture of wearing apparel, except fur apparel",
  "parentCode": "141"
 },
 {
  "level": "Class",
  "code": "1420",
  "section": "C",
  "name": "Manufacture of articles of fur",
  "parentCode": "142"
 },
 {
  "level": "Class",
  "code": "1430",
  "section": "C",
  "name": "Manufacture of knitted and crocheted apparel",
  "parentCode": "143"
 },
 {
  "level": "Class",
  "code": "1511",
  "section": "C",
  "name": "Tanning and dressing of leather; dressing and dyeing of fur",
  "parentCode": "151"
 },
 {
  "level": "Class",
  "code": "1512",
  "section": "C",
  "name": "Manufacture of luggage, handbags and the like, saddlery and harness of any material",
  "parentCode": "151"
 },
 {
  "level": "Class",
  "code": "1520",
  "section": "C",
  "name": "Manufacture of footwear",
  "parentCode": "152"
 },
 {
  "level": "Class",
  "code": "1610",
  "section": "C",
  "name": "Sawmilling and planing of wood",
  "parentCode": "161"
 },
 {
  "level": "Class",
  "code": "1621",
  "section": "C",
  "name": "Manufacture of veneer sheets and wood-based panels",
  "parentCode": "162"
 },
 {
  "level": "Class",
  "code": "1622",
  "section": "C",
  "name": "Manufacture of builders' carpentry and joinery",
  "parentCode": "162"
 },
 {
  "level": "Class",
  "code": "1623",
  "section": "C",
  "name": "Manufacture of wooden containers",
  "parentCode": "162"
 },
 {
  "level": "Class",
  "code": "1629",
  "section": "C",
  "name": "Manufacture of other products of wood; manufacture of articles of cork, straw and plaiting materials",
  "parentCode": "162"
 },
 {
  "level": "Class",
  "code": "1701",
  "section": "C",
  "name": "Manufacture of pulp, paper and paperboard",
  "parentCode": "170"
 },
 {
  "level": "Class",
  "code": "1702",
  "section": "C",
  "name": "Manufacture of corrugated paper and paperboard and of containers of paper and paperboard",
  "parentCode": "170"
 },
 {
  "level": "Class",
  "code": "1709",
  "section": "C",
  "name": "Manufacture of other articles of paper and paperboard",
  "parentCode": "170"
 },
 {
  "level": "Class",
  "code": "1811",
  "section": "C",
  "name": "Printing",
  "parentCode": "181"
 },
 {
  "level": "Class",
  "code": "1812",
  "section": "C",
  "name": "Service activities related to printing",
  "parentCode": "181"
 },
 {
  "level": "Class",
  "code": "1820",
  "section": "C",
  "name": "Reproduction of recorded media",
  "parentCode": "182"
 },
 {
  "level": "Class",
  "code": "1910",
  "section": "C",
  "name": "Manufacture of coke oven products",
  "parentCode": "191"
 },
 {
  "level": "Class",
  "code": "1920",
  "section": "C",
  "name": "Manufacture of refined petroleum products; manufacture of fossil fuel products",
  "parentCode": "192"
 },
 {
  "level": "Class",
  "code": "2011",
  "section": "C",
  "name": "Manufacture of basic chemicals",
  "parentCode": "201"
 },
 {
  "level": "Class",
  "code": "2012",
  "section": "C",
  "name": "Manufacture of fertilizers and nitrogen compounds",
  "parentCode": "201"
 },
 {
  "level": "Class",
  "code": "2013",
  "section": "C",
  "name": "Manufacture of plastics and synthetic rubber in primary forms",
  "parentCode": "201"
 },
 {
  "level": "Class",
  "code": "2021",
  "section": "C",
  "name": "Manufacture of pesticides and other agrochemical products",
  "parentCode": "202"
 },
 {
  "level": "Class",
  "code": "2022",
  "section": "C",
  "name": "Manufacture of paints, varnishes and similar coatings, printing ink and mastics",
  "parentCode": "202"
 },
 {
  "level": "Class",
  "code": "2023",
  "section": "C",
  "name": "Manufacture of soap and detergents, cleaning and polishing preparations, perfumes and toilet preparations",
  "parentCode": "202"
 },
 {
  "level": "Class",
  "code": "2029",
  "section": "C",
  "name": "Manufacture of other chemical products n.e.c.",
  "parentCode": "202"
 },
 {
  "level": "Class",
  "code": "2030",
  "section": "C",
  "name": "Manufacture of man-made fibres",
  "parentCode": "203"
 },
 {
  "level": "Class",
  "code": "2100",
  "section": "C",
  "name": "Manufacture of pharmaceuticals, medicinal chemical and botanical products",
  "parentCode": "210"
 },
 {
  "level": "Class",
  "code": "2211",
  "section": "C",
  "name": "Manufacture of rubber tyres and tubes; retreading and rebuilding of rubber tyres",
  "parentCode": "221"
 },
 {
  "level": "Class",
  "code": "2219",
  "section": "C",
  "name": "Manufacture of other rubber products",
  "parentCode": "221"
 },
 {
  "level": "Class",
  "code": "2220",
  "section": "C",
  "name": "Manufacture of plastics products",
  "parentCode": "222"
 },
 {
  "level": "Class",
  "code": "2310",
  "section": "C",
  "name": "Manufacture of glass and glass products",
  "parentCode": "231"
 },
 {
  "level": "Class",
  "code": "2391",
  "section": "C",
  "name": "Manufacture of refractory products",
  "parentCode": "239"
 },
 {
  "level": "Class",
  "code": "2392",
  "section": "C",
  "name": "Manufacture of clay building materials",
  "parentCode": "239"
 },
 {
  "level": "Class",
  "code": "2393",
  "section": "C",
  "name": "Manufacture of other porcelain and ceramic products",
  "parentCode": "239"
 },
 {
  "level": "Class",
  "code": "2394",
  "section": "C",
  "name": "Manufacture of cement, lime and plaster",
  "parentCode": "239"
 },
 {
  "level": "Class",
  "code": "2395",
  "section": "C",
  "name": "Manufacture of articles of concrete, cement and plaster",
  "parentCode": "239"
 },
 {
  "level": "Class",
  "code": "2396",
  "section": "C",
  "name": "Cutting, shaping and finishing of stone",
  "parentCode": "239"
 },
 {
  "level": "Class",
  "code": "2399",
  "section": "C",
  "name": "Manufacture of other non-metallic mineral products n.e.c.",
  "parentCode": "239"
 },
 {
  "level": "Class",
  "code": "2410",
  "section": "C",
  "name": "Manufacture of basic iron and steel",
  "parentCode": "241"
 },
 {
  "level": "Class",
  "code": "2420",
  "section": "C",
  "name": "Manufacture of basic precious and other non-ferrous metals",
  "parentCode": "242"
 },
 {
  "level": "Class",
  "code": "2431",
  "section": "C",
  "name": "Casting of iron and steel",
  "parentCode": "243"
 },
 {
  "level": "Class",
  "code": "2432",
  "section": "C",
  "name": "Casting of non-ferrous metals",
  "parentCode": "243"
 },
 {
  "level": "Class",
  "code": "2511",
  "section": "C",
  "name": "Manufacture of structural metal products",
  "parentCode": "251"
 },
 {
  "level": "Class",
  "code": "2512",
  "section": "C",
  "name": "Manufacture of tanks, reservoirs and containers of metal",
  "parentCode": "251"
 },
 {
  "level": "Class",
  "code": "2513",
  "section": "C",
  "name": "Manufacture of steam generators, except central heating hot water boilers",
  "parentCode": "251"
 },
 {
  "level": "Class",
  "code": "2520",
  "section": "C",
  "name": "Manufacture of weapons and ammunition",
  "parentCode": "252"
 },
 {
  "level": "Class",
  "code": "2591",
  "section": "C",
  "name": "Forging, pressing, stamping and roll-forming of metal; powder metallurgy",
  "parentCode": "259"
 },
 {
  "level": "Class",
  "code": "2592",
  "section": "C",
  "name": "Treatment and coating of metals; machining",
  "parentCode": "259"
 },
 {
  "level": "Class",
  "code": "2593",
  "section": "C",
  "name": "Manufacture of cutlery, hand tools and general hardware",
  "parentCode": "259"
 },
 {
  "level": "Class",
  "code": "2599",
  "section": "C",
  "name": "Manufacture of other fabricated metal products n.e.c.",
  "parentCode": "259"
 },
 {
  "level": "Class",
  "code": "2611",
  "section": "C",
  "name": "Manufacture of solar cells, solar panels and photovoltaic inverters",
  "parentCode": "261"
 },
 {
  "level": "Class",
  "code": "2619",
  "section": "C",
  "name": "Manufacture of other electronic components and boards",
  "parentCode": "261"
 },
 {
  "level": "Class",
  "code": "2620",
  "section": "C",
  "name": "Manufacture of computers and peripheral equipment",
  "parentCode": "262"
 },
 {
  "level": "Class",
  "code": "2630",
  "section": "C",
  "name": "Manufacture of communication equipment",
  "parentCode": "263"
 },
 {
  "level": "Class",
  "code": "2640",
  "section": "C",
  "name": "Manufacture of consumer electronics",
  "parentCode": "264"
 },
 {
  "level": "Class",
  "code": "2651",
  "section": "C",
  "name": "Manufacture of measuring, testing, navigating and control equipment",
  "parentCode": "265"
 },
 {
  "level": "Class",
  "code": "2652",
  "section": "C",
  "name": "Manufacture of watches and clocks",
  "parentCode": "265"
 },
 {
  "level": "Class",
  "code": "2660",
  "section": "C",
  "name": "Manufacture of irradiation, electromedical and electrotherapeutic equipment",
  "parentCode": "266"
 },
 {
  "level": "Class",
  "code": "2670",
  "section": "C",
  "name": "Manufacture of optical instruments and photographic equipment",
  "parentCode": "267"
 },
 {
  "level": "Class",
  "code": "2680",
  "section": "C",
  "name": "Manufacture of magnetic and optical media",
  "parentCode": "268"
 },
 {
  "level": "Class",
  "code": "2710",
  "section": "C",
  "name": "Manufacture of electric motors, generators, transformers and electricity distribution and control apparatus",
  "parentCode": "271"
 },
 {
  "level": "Class",
  "code": "2720",
  "section": "C",
  "name": "Manufacture of batteries and accumulators",
  "parentCode": "272"
 },
 {
  "level": "Class",
  "code": "2731",
  "section": "C",
  "name": "Manufacture of fibre optic cables",
  "parentCode": "273"
 },
 {
  "level": "Class",
  "code": "2732",
  "section": "C",
  "name": "Manufacture of other electronic and electric wires and cables",
  "parentCode": "273"
 },
 {
  "level": "Class",
  "code": "2733",
  "section": "C",
  "name": "Manufacture of wiring devices",
  "parentCode": "273"
 },
 {
  "level": "Class",
  "code": "2740",
  "section": "C",
  "name": "Manufacture of lighting equipment",
  "parentCode": "274"
 },
 {
  "level": "Class",
  "code": "2750",
  "section": "C",
  "name": "Manufacture of domestic appliances",
  "parentCode": "275"
 },
 {
  "level": "Class",
  "code": "2790",
  "section": "C",
  "name": "Manufacture of other electrical equipment",
  "parentCode": "279"
 },
 {
  "level": "Class",
  "code": "2811",
  "section": "C",
  "name": "Manufacture of engines and turbines, except aircraft, vehicle and cycle engines",
  "parentCode": "281"
 },
 {
  "level": "Class",
  "code": "2812",
  "section": "C",
  "name": "Manufacture of fluid power equipment",
  "parentCode": "281"
 },
 {
  "level": "Class",
  "code": "2813",
  "section": "C",
  "name": "Manufacture of other pumps, compressors, taps and valves",
  "parentCode": "281"
 },
 {
  "level": "Class",
  "code": "2814",
  "section": "C",
  "name": "Manufacture of bearings, gears, gearing and driving elements",
  "parentCode": "281"
 },
 {
  "level": "Class",
  "code": "2815",
  "section": "C",
  "name": "Manufacture of ovens, furnaces and permanent household heating equipment",
  "parentCode": "281"
 },
 {
  "level": "Class",
  "code": "2816",
  "section": "C",
  "name": "Manufacture of lifting and handling equipment",
  "parentCode": "281"
 },
 {
  "level": "Class",
  "code": "2817",
  "section": "C",
  "name": "Manufacture of office machinery and equipment (except computers and peripheral equipment)",
  "parentCode": "281"
 },
 {
  "level": "Class",
  "code": "2818",
  "section": "C",
  "name": "Manufacture of power-driven hand tools",
  "parentCode": "281"
 },
 {
  "level": "Class",
  "code": "2819",
  "section": "C",
  "name": "Manufacture of other general-purpose machinery",
  "parentCode": "281"
 },
 {
  "level": "Class",
  "code": "2821",
  "section": "C",
  "name": "Manufacture of agricultural and forestry machinery",
  "parentCode": "282"
 },
 {
  "level": "Class",
  "code": "2822",
  "section": "C",
  "name": "Manufacture of metal-forming machinery and machine tools",
  "parentCode": "282"
 },
 {
  "level": "Class",
  "code": "2823",
  "section": "C",
  "name": "Manufacture of machinery for metallurgy",
  "parentCode": "282"
 },
 {
  "level": "Class",
  "code": "2824",
  "section": "C",
  "name": "Manufacture of machinery for mining, quarrying and construction",
  "parentCode": "282"
 },
 {
  "level": "Class",
  "code": "2825",
  "section": "C",
  "name": "Manufacture of machinery for food, beverage and tobacco processing",
  "parentCode": "282"
 },
 {
  "level": "Class",
  "code": "2826",
  "section": "C",
  "name": "Manufacture of machinery for textile, apparel and leather production",
  "parentCode": "282"
 },
 {
  "level": "Class",
  "code": "2829",
  "section": "C",
  "name": "Manufacture of other special-purpose machinery",
  "parentCode": "282"
 },
 {
  "level": "Class",
  "code": "2910",
  "section": "C",
  "name": "Manufacture of motor vehicles",
  "parentCode": "291"
 },
 {
  "level": "Class",
  "code": "2920",
  "section": "C",
  "name": "Manufacture of bodies (coachwork) for motor vehicles; manufacture of trailers and semi-trailers",
  "parentCode": "292"
 },
 {
  "level": "Class",
  "code": "2930",
  "section": "C",
  "name": "Manufacture of parts and accessories for motor vehicles",
  "parentCode": "293"
 },
 {
  "level": "Class",
  "code": "3011",
  "section": "C",
  "name": "Building of ships and floating structures",
  "parentCode": "301"
 },
 {
  "level": "Class",
  "code": "3012",
  "section": "C",
  "name": "Building of pleasure and sporting boats",
  "parentCode": "301"
 },
 {
  "level": "Class",
  "code": "3020",
  "section": "C",
  "name": "Manufacture of railway locomotives and rolling stock",
  "parentCode": "302"
 },
 {
  "level": "Class",
  "code": "3030",
  "section": "C",
  "name": "Manufacture of air and spacecraft and related machinery",
  "parentCode": "303"
 },
 {
  "level": "Class",
  "code": "3040",
  "section": "C",
  "name": "Manufacture of military fighting vehicles",
  "parentCode": "304"
 },
 {
  "level": "Class",
  "code": "3091",
  "section": "C",
  "name": "Manufacture of motorcycles",
  "parentCode": "309"
 },
 {
  "level": "Class",
  "code": "3092",
  "section": "C",
  "name": "Manufacture of bicycles and invalid carriages",
  "parentCode": "309"
 },
 {
  "level": "Class",
  "code": "3099",
  "section": "C",
  "name": "Manufacture of other transport equipment n.e.c.",
  "parentCode": "309"
 },
 {
  "level": "Class",
  "code": "3101",
  "section": "C",
  "name": "Manufacture of wooden furniture",
  "parentCode": "310"
 },
 {
  "level": "Class",
  "code": "3102",
  "section": "C",
  "name": "Manufacture of other furniture",
  "parentCode": "310"
 },
 {
  "level": "Class",
  "code": "3211",
  "section": "C",
  "name": "Manufacture of jewellery and related articles",
  "parentCode": "321"
 },
 {
  "level": "Class",
  "code": "3212",
  "section": "C",
  "name": "Manufacture of imitation jewellery and related articles",
  "parentCode": "321"
 },
 {
  "level": "Class",
  "code": "3220",
  "section": "C",
  "name": "Manufacture of musical instruments",
  "parentCode": "322"
 },
 {
  "level": "Class",
  "code": "3230",
  "section": "C",
  "name": "Manufacture of sports goods",
  "parentCode": "323"
 },
 {
  "level": "Class",
  "code": "3240",
  "section": "C",
  "name": "Manufacture of games and toys",
  "parentCode": "324"
 },
 {
  "level": "Class",
  "code": "3250",
  "section": "C",
  "name": "Manufacture of medical and dental instruments and supplies",
  "parentCode": "325"
 },
 {
  "level": "Class",
  "code": "3290",
  "section": "C",
  "name": "Other manufacturing n.e.c.",
  "parentCode": "329"
 },
 {
  "level": "Class",
  "code": "3311",
  "section": "C",
  "name": "Repair and maintenance of fabricated metal products",
  "parentCode": "331"
 },
 {
  "level": "Class",
  "code": "3312",
  "section": "C",
  "name": "Repair and maintenance of machinery",
  "parentCode": "331"
 },
 {
  "level": "Class",
  "code": "3313",
  "section": "C",
  "name": "Repair and maintenance of electronic and optical equipment",
  "parentCode": "331"
 },
 {
  "level": "Class",
  "code": "3314",
  "section": "C",
  "name": "Repair and maintenance of electrical equipment",
  "parentCode": "331"
 },
 {
  "level": "Class",
  "code": "3315",
  "section": "C",
  "name": "Repair and maintenance of transport equipment, except motor vehicles",
  "parentCode": "331"
 },
 {
  "level": "Class",
  "code": "3319",
  "section": "C",
  "name": "Repair and maintenance of other equipment",
  "parentCode": "331"
 },
 {
  "level": "Class",
  "code": "3320",
  "section": "C",
  "name": "Installation of industrial machinery and equipment",
  "parentCode": "332"
 },
 {
  "level": "Class",
  "code": "3511",
  "section": "D",
  "name": "Electric power generation activities from non-renewable sources",
  "parentCode": "351"
 },
 {
  "level": "Class",
  "code": "3512",
  "section": "D",
  "name": "Electric power generation activities from renewable sources",
  "parentCode": "351"
 },
 {
  "level": "Class",
  "code": "3513",
  "section": "D",
  "name": "Electric power transmission and distribution activities",
  "parentCode": "351"
 },
 {
  "level": "Class",
  "code": "3520",
  "section": "D",
  "name": "Manufacture of gas; distribution of gaseous fuels through mains",
  "parentCode": "352"
 },
 {
  "level": "Class",
  "code": "3530",
  "section": "D",
  "name": "Steam and air conditioning supply",
  "parentCode": "353"
 },
 {
  "level": "Class",
  "code": "3540",
  "section": "D",
  "name": "Activities of brokers and agents for electric power and natural gas",
  "parentCode": "354"
 },
 {
  "level": "Class",
  "code": "3600",
  "section": "E",
  "name": "Water collection, treatment and supply",
  "parentCode": "360"
 },
 {
  "level": "Class",
  "code": "3700",
  "section": "E",
  "name": "Sewerage",
  "parentCode": "370"
 },
 {
  "level": "Class",
  "code": "3811",
  "section": "E",
  "name": "Collection of non-hazardous waste",
  "parentCode": "381"
 },
 {
  "level": "Class",
  "code": "3812",
  "section": "E",
  "name": "Collection of hazardous waste",
  "parentCode": "381"
 },
 {
  "level": "Class",
  "code": "3821",
  "section": "E",
  "name": "Treatment and disposal of non-hazardous waste",
  "parentCode": "382"
 },
 {
  "level": "Class",
  "code": "3822",
  "section": "E",
  "name": "Treatment and disposal of hazardous waste",
  "parentCode": "382"
 },
 {
  "level": "Class",
  "code": "3830",
  "section": "E",
  "name": "Materials and other waste recovery",
  "parentCode": "383"
 },
 {
  "level": "Class",
  "code": "3900",
  "section": "E",
  "name": "Remediation and other waste management service activities",
  "parentCode": "390"
 },
 {
  "level": "Class",
  "code": "4100",
  "section": "F",
  "name": "Construction of residential and non-residential buildings",
  "parentCode": "410"
 },
 {
  "level": "Class",
  "code": "4210",
  "section": "F",
  "name": "Construction of roads and railways",
  "parentCode": "421"
 },
 {
  "level": "Class",
  "code": "4220",
  "section": "F",
  "name": "Construction of utility projects",
  "parentCode": "422"
 },
 {
  "level": "Class",
  "code": "4290",
  "section": "F",
  "name": "Construction of other civil engineering projects",
  "parentCode": "429"
 },
 {
  "level": "Class",
  "code": "4311",
  "section": "F",
  "name": "Demolition",
  "parentCode": "431"
 },
 {
  "level": "Class",
  "code": "4312",
  "section": "F",
  "name": "Site preparation",
  "parentCode": "431"
 },
 {
  "level": "Class",
  "code": "4321",
  "section": "F",
  "name": "Electrical installation",
  "parentCode": "432"
 },
 {
  "level": "Class",
  "code": "4322",
  "section": "F",
  "name": "Plumbing, heat and air-conditioning installation",
  "parentCode": "432"
 },
 {
  "level": "Class",
  "code": "4329",
  "section": "F",
  "name": "Other construction installation",
  "parentCode": "432"
 },
 {
  "level": "Class",
  "code": "4330",
  "section": "F",
  "name": "Building completion and finishing",
  "parentCode": "433"
 },
 {
  "level": "Class",
  "code": "4340",
  "section": "F",
  "name": "Intermediation service activities for specialized construction services",
  "parentCode": "434"
 },
 {
  "level": "Class",
  "code": "4390",
  "section": "F",
  "name": "Other specialized construction activities",
  "parentCode": "439"
 },
 {
  "level": "Class",
  "code": "4610",
  "section": "G",
  "name": "Wholesale on a fee or contract basis",
  "parentCode": "461"
 },
 {
  "level": "Class",
  "code": "4620",
  "section": "G",
  "name": "Wholesale of agricultural raw materials and live animals",
  "parentCode": "462"
 },
 {
  "level": "Class",
  "code": "4630",
  "section": "G",
  "name": "Wholesale of food, beverages and tobacco",
  "parentCode": "463"
 },
 {
  "level": "Class",
  "code": "4641",
  "section": "G",
  "name": "Wholesale of textiles, clothing and footwear",
  "parentCode": "464"
 },
 {
  "level": "Class",
  "code": "4642",
  "section": "G",
  "name": "Wholesale of household, office and shop furniture, carpets and lighting equipment",
  "parentCode": "464"
 },
 {
  "level": "Class",
  "code": "4649",
  "section": "G",
  "name": "Wholesale of other household goods",
  "parentCode": "464"
 },
 {
  "level": "Class",
  "code": "4651",
  "section": "G",
  "name": "Wholesale of computers, computer peripheral equipment and software",
  "parentCode": "465"
 },
 {
  "level": "Class",
  "code": "4652",
  "section": "G",
  "name": "Wholesale of electronic and telecommunications equipment and parts",
  "parentCode": "465"
 },
 {
  "level": "Class",
  "code": "4653",
  "section": "G",
  "name": "Wholesale of agricultural machinery, equipment and supplies",
  "parentCode": "465"
 },
 {
  "level": "Class",
  "code": "4659",
  "section": "G",
  "name": "Wholesale of other machinery and equipment",
  "parentCode": "465"
 },
 {
  "level": "Class",
  "code": "4661",
  "section": "G",
  "name": "Wholesale of motor vehicles",
  "parentCode": "466"
 },
 {
  "level": "Class",
  "code": "4662",
  "section": "G",
  "name": "Wholesale of motor vehicle parts and accessories",
  "parentCode": "466"
 },
 {
  "level": "Class",
  "code": "4663",
  "section": "G",
  "name": "Wholesale of motorcycles, motorcycle parts and accessories",
  "parentCode": "466"
 },
 {
  "level": "Class",
  "code": "4671",
  "section": "G",
  "name": "Wholesale of solid, liquid and gaseous fuels and related products",
  "parentCode": "467"
 },
 {
  "level": "Class",
  "code": "4672",
  "section": "G",
  "name": "Wholesale of metals and metal ores",
  "parentCode": "467"
 },
 {
  "level": "Class",
  "code": "4673",
  "section": "G",
  "name": "Wholesale of construction materials, hardware, plumbing and heating equipment and supplies",
  "parentCode": "467"
 },
 {
  "level": "Class",
  "code": "4679",
  "section": "G",
  "name": "Wholesale of chemicals, waste and scrap and other products n.e.c.",
  "parentCode": "467"
 },
 {
  "level": "Class",
  "code": "4690",
  "section": "G",
  "name": "Non-specialized wholesale trade",
  "parentCode": "469"
 },
 {
  "level": "Class",
  "code": "4711",
  "section": "G",
  "name": "Non-specialized retail sale with food, beverages or tobacco predominating",
  "parentCode": "471"
 },
 {
  "level": "Class",
  "code": "4719",
  "section": "G",
  "name": "Other non-specialized retail sale",
  "parentCode": "471"
 },
 {
  "level": "Class",
  "code": "4721",
  "section": "G",
  "name": "Retail sale of food",
  "parentCode": "472"
 },
 {
  "level": "Class",
  "code": "4722",
  "section": "G",
  "name": "Retail sale of beverages",
  "parentCode": "472"
 },
 {
  "level": "Class",
  "code": "4723",
  "section": "G",
  "name": "Retail sale of tobacco products",
  "parentCode": "472"
 },
 {
  "level": "Class",
  "code": "4730",
  "section": "G",
  "name": "Retail sale of automotive fuel",
  "parentCode": "473"
 },
 {
  "level": "Class",
  "code": "4740",
  "section": "G",
  "name": "Retail sale of information and communication equipment",
  "parentCode": "474"
 },
 {
  "level": "Class",
  "code": "4751",
  "section": "G",
  "name": "Retail sale of textiles",
  "parentCode": "475"
 },
 {
  "level": "Class",
  "code": "4752",
  "section": "G",
  "name": "Retail sale of hardware, building materials, paints and glass",
  "parentCode": "475"
 },
 {
  "level": "Class",
  "code": "4753",
  "section": "G",
  "name": "Retail sale of carpets, rugs, wall and floor coverings",
  "parentCode": "475"
 },
 {
  "level": "Class",
  "code": "4759",
  "section": "G",
  "name": "Retail sale of electrical household appliances, furniture, lighting equipment and other household articles",
  "parentCode": "475"
 },
 {
  "level": "Class",
  "code": "4761",
  "section": "G",
  "name": "Retail sale of books, newspapers, stationery and office supplies",
  "parentCode": "476"
 },
 {
  "level": "Class",
  "code": "4762",
  "section": "G",
  "name": "Retail sale of sporting equipment",
  "parentCode": "476"
 },
 {
  "level": "Class",
  "code": "4763",
  "section": "G",
  "name": "Retail sale of games and toys",
  "parentCode": "476"
 },
 {
  "level": "Class",
  "code": "4769",
  "section": "G",
  "name": "Retail sale of cultural and recreational goods n.e.c.",
  "parentCode": "476"
 },
 {
  "level": "Class",
  "code": "4771",
  "section": "G",
  "name": "Retail sale of clothing, footwear and leather articles",
  "parentCode": "477"
 },
 {
  "level": "Class",
  "code": "4772",
  "section": "G",
  "name": "Retail sale of pharmaceutical and medical goods, cosmetic and toilet articles",
  "parentCode": "477"
 },
 {
  "level": "Class",
  "code": "4773",
  "section": "G",
  "name": "Retail sale of other new goods n.e.c.",
  "parentCode": "477"
 },
 {
  "level": "Class",
  "code": "4774",
  "section": "G",
  "name": "Retail sale of second-hand goods",
  "parentCode": "477"
 },
 {
  "level": "Class",
  "code": "4781",
  "section": "G",
  "name": "Retail sale of motor vehicles",
  "parentCode": "478"
 },
 {
  "level": "Class",
  "code": "4782",
  "section": "G",
  "name": "Retail sale of motor vehicle parts and accessories",
  "parentCode": "478"
 },
 {
  "level": "Class",
  "code": "4783",
  "section": "G",
  "name": "Retail sale of motorcycles, motorcycles parts and accessories",
  "parentCode": "478"
 },
 {
  "level": "Class",
  "code": "4790",
  "section": "G",
  "name": "Intermediation service activities for retail sale",
  "parentCode": "479"
 },
 {
  "level": "Class",
  "code": "4911",
  "section": "H",
  "name": "Passenger rail transport, interurban",
  "parentCode": "491"
 },
 {
  "level": "Class",
  "code": "4912",
  "section": "H",
  "name": "Freight rail transport",
  "parentCode": "491"
 },
 {
  "level": "Class",
  "code": "4921",
  "section": "H",
  "name": "Urban and suburban passenger land transport",
  "parentCode": "492"
 },
 {
  "level": "Class",
  "code": "4922",
  "section": "H",
  "name": "Other passenger land transport",
  "parentCode": "492"
 },
 {
  "level": "Class",
  "code": "4923",
  "section": "H",
  "name": "Freight transport by road",
  "parentCode": "492"
 },
 {
  "level": "Class",
  "code": "4930",
  "section": "H",
  "name": "Transport via pipeline",
  "parentCode": "493"
 },
 {
  "level": "Class",
  "code": "5011",
  "section": "H",
  "name": "Sea and coastal passenger water transport",
  "parentCode": "501"
 },
 {
  "level": "Class",
  "code": "5012",
  "section": "H",
  "name": "Sea and coastal freight water transport",
  "parentCode": "501"
 },
 {
  "level": "Class",
  "code": "5021",
  "section": "H",
  "name": "Inland passenger water transport",
  "parentCode": "502"
 },
 {
  "level": "Class",
  "code": "5022",
  "section": "H",
  "name": "Inland freight water transport",
  "parentCode": "502"
 },
 {
  "level": "Class",
  "code": "5110",
  "section": "H",
  "name": "Passenger air transport",
  "parentCode": "511"
 },
 {
  "level": "Class",
  "code": "5120",
  "section": "H",
  "name": "Freight air transport",
  "parentCode": "512"
 },
 {
  "level": "Class",
  "code": "5210",
  "section": "H",
  "name": "Warehousing and storage",
  "parentCode": "521"
 },
 {
  "level": "Class",
  "code": "5221",
  "section": "H",
  "name": "Service activities incidental to land transportation",
  "parentCode": "522"
 },
 {
  "level": "Class",
  "code": "5222",
  "section": "H",
  "name": "Service activities incidental to water transportation",
  "parentCode": "522"
 },
 {
  "level": "Class",
  "code": "5223",
  "section": "H",
  "name": "Service activities incidental to air transportation",
  "parentCode": "522"
 },
 {
  "level": "Class",
  "code": "5224",
  "section": "H",
  "name": "Cargo handling",
  "parentCode": "522"
 },
 {
  "level": "Class",
  "code": "5229",
  "section": "H",
  "name": "Other support activities for transportation",
  "parentCode": "522"
 },
 {
  "level": "Class",
  "code": "5231",
  "section": "H",
  "name": "Intermediation service activities for freight transportation",
  "parentCode": "523"
 },
 {
  "level": "Class",
  "code": "5232",
  "section": "H",
  "name": "Intermediation service activities for passenger transportation",
  "parentCode": "523"
 },
 {
  "level": "Class",
  "code": "5310",
  "section": "H",
  "name": "Postal activities",
  "parentCode": "531"
 },
 {
  "level": "Class",
  "code": "5320",
  "section": "H",
  "name": "Courier activities",
  "parentCode": "532"
 },
 {
  "level": "Class",
  "code": "5330",
  "section": "H",
  "name": "Intermediation service activities for postal and courier activities",
  "parentCode": "533"
 },
 {
  "level": "Class",
  "code": "5510",
  "section": "I",
  "name": "Hotels and similar accommodation activities",
  "parentCode": "551"
 },
 {
  "level": "Class",
  "code": "5520",
  "section": "I",
  "name": "Other short term accommodation activities",
  "parentCode": "552"
 },
 {
  "level": "Class",
  "code": "5530",
  "section": "I",
  "name": "Camping grounds, recreational vehicle parks and trailer parks",
  "parentCode": "553"
 },
 {
  "level": "Class",
  "code": "5540",
  "section": "I",
  "name": "Intermediation service activities for accommodation",
  "parentCode": "554"
 },
 {
  "level": "Class",
  "code": "5590",
  "section": "I",
  "name": "Other accommodation n.e.c.",
  "parentCode": "559"
 },
 {
  "level": "Class",
  "code": "5610",
  "section": "I",
  "name": "Restaurants and mobile food service activities",
  "parentCode": "561"
 },
 {
  "level": "Class",
  "code": "5621",
  "section": "I",
  "name": "Event catering activities",
  "parentCode": "562"
 },
 {
  "level": "Class",
  "code": "5629",
  "section": "I",
  "name": "Other food service activities",
  "parentCode": "562"
 },
 {
  "level": "Class",
  "code": "5630",
  "section": "I",
  "name": "Beverage serving activities",
  "parentCode": "563"
 },
 {
  "level": "Class",
  "code": "5640",
  "section": "I",
  "name": "Intermediation service activities for food and beverage services activities",
  "parentCode": "564"
 },
 {
  "level": "Class",
  "code": "5811",
  "section": "J",
  "name": "Publishing of books",
  "parentCode": "581"
 },
 {
  "level": "Class",
  "code": "5812",
  "section": "J",
  "name": "Publishing of newspapers",
  "parentCode": "581"
 },
 {
  "level": "Class",
  "code": "5813",
  "section": "J",
  "name": "Publishing of journals and periodicals",
  "parentCode": "581"
 },
 {
  "level": "Class",
  "code": "5819",
  "section": "J",
  "name": "Other publishing activities",
  "parentCode": "581"
 },
 {
  "level": "Class",
  "code": "5821",
  "section": "J",
  "name": "Publishing of video games",
  "parentCode": "582"
 },
 {
  "level": "Class",
  "code": "5829",
  "section": "J",
  "name": "Other software publishing",
  "parentCode": "582"
 },
 {
  "level": "Class",
  "code": "5911",
  "section": "J",
  "name": "Motion picture, video and television programme production activities",
  "parentCode": "591"
 },
 {
  "level": "Class",
  "code": "5912",
  "section": "J",
  "name": "Motion picture, video and television programme post-production activities",
  "parentCode": "591"
 },
 {
  "level": "Class",
  "code": "5913",
  "section": "J",
  "name": "Motion picture, video and television programme distribution activities",
  "parentCode": "591"
 },
 {
  "level": "Class",
  "code": "5914",
  "section": "J",
  "name": "Motion picture projection activities",
  "parentCode": "591"
 },
 {
  "level": "Class",
  "code": "5920",
  "section": "J",
  "name": "Sound recording and music publishing activities",
  "parentCode": "592"
 },
 {
  "level": "Class",
  "code": "6010",
  "section": "J",
  "name": "Radio broadcasting and audio distribution activities",
  "parentCode": "601"
 },
 {
  "level": "Class",
  "code": "6020",
  "section": "J",
  "name": "Television programming, broadcasting and video distribution activities",
  "parentCode": "602"
 },
 {
  "level": "Class",
  "code": "6031",
  "section": "J",
  "name": "News agency activities",
  "parentCode": "603"
 },
 {
  "level": "Class",
  "code": "6039",
  "section": "J",
  "name": "Social network sites and other content distribution activities",
  "parentCode": "603"
 },
 {
  "level": "Class",
  "code": "6110",
  "section": "K",
  "name": "Wired, wireless, and satellite telecommunication activities",
  "parentCode": "611"
 },
 {
  "level": "Class",
  "code": "6120",
  "section": "K",
  "name": "Telecommunication reselling activities and intermediation service activities for telecommunication",
  "parentCode": "612"
 },
 {
  "level": "Class",
  "code": "6190",
  "section": "K",
  "name": "Other telecommunication activities",
  "parentCode": "619"
 },
 {
  "level": "Class",
  "code": "6211",
  "section": "K",
  "name": "Development of video games, video game software, and video game software tools",
  "parentCode": "621"
 },
 {
  "level": "Class",
  "code": "6219",
  "section": "K",
  "name": "Other computer programming activities",
  "parentCode": "621"
 },
 {
  "level": "Class",
  "code": "6220",
  "section": "K",
  "name": "Computer consultancy and computer facilities management activities",
  "parentCode": "622"
 },
 {
  "level": "Class",
  "code": "6290",
  "section": "K",
  "name": "Other information technology and computer service activities",
  "parentCode": "629"
 },
 {
  "level": "Class",
  "code": "6310",
  "section": "K",
  "name": "Computing infrastructure, data processing, hosting and related activities",
  "parentCode": "631"
 },
 {
  "level": "Class",
  "code": "6390",
  "section": "K",
  "name": "Web search portals activities and other information service activities",
  "parentCode": "639"
 },
 {
  "level": "Class",
  "code": "6411",
  "section": "L",
  "name": "Central banking",
  "parentCode": "641"
 },
 {
  "level": "Class",
  "code": "6419",
  "section": "L",
  "name": "Other monetary intermediation",
  "parentCode": "641"
 },
 {
  "level": "Class",
  "code": "6421",
  "section": "L",
  "name": "Activities of holding companies",
  "parentCode": "642"
 },
 {
  "level": "Class",
  "code": "6422",
  "section": "L",
  "name": "Activities of financing conduits",
  "parentCode": "642"
 },
 {
  "level": "Class",
  "code": "6431",
  "section": "L",
  "name": "Activities of money market funds",
  "parentCode": "643"
 },
 {
  "level": "Class",
  "code": "6432",
  "section": "L",
  "name": "Activities of non-money market investments funds",
  "parentCode": "643"
 },
 {
  "level": "Class",
  "code": "6433",
  "section": "L",
  "name": "Activities of trust, estate and agency accounts",
  "parentCode": "643"
 },
 {
  "level": "Class",
  "code": "6491",
  "section": "L",
  "name": "Financial leasing activities",
  "parentCode": "649"
 },
 {
  "level": "Class",
  "code": "6492",
  "section": "L",
  "name": "International trade financing activities",
  "parentCode": "649"
 },
 {
  "level": "Class",
  "code": "6493",
  "section": "L",
  "name": "Factoring activities",
  "parentCode": "649"
 },
 {
  "level": "Class",
  "code": "6494",
  "section": "L",
  "name": "Securitisation activities",
  "parentCode": "649"
 },
 {
  "level": "Class",
  "code": "6495",
  "section": "L",
  "name": "Other credit granting activities",
  "parentCode": "649"
 },
 {
  "level": "Class",
  "code": "6499",
  "section": "L",
  "name": "Other financial service activities n.e.c., except insurance and pension funding activities",
  "parentCode": "649"
 },
 {
  "level": "Class",
  "code": "6511",
  "section": "L",
  "name": "Life insurance",
  "parentCode": "651"
 },
 {
  "level": "Class",
  "code": "6512",
  "section": "L",
  "name": "Non-life insurance",
  "parentCode": "651"
 },
 {
  "level": "Class",
  "code": "6520",
  "section": "L",
  "name": "Reinsurance",
  "parentCode": "652"
 },
 {
  "level": "Class",
  "code": "6530",
  "section": "L",
  "name": "Pension funding",
  "parentCode": "653"
 },
 {
  "level": "Class",
  "code": "6611",
  "section": "L",
  "name": "Administration of financial markets",
  "parentCode": "661"
 },
 {
  "level": "Class",
  "code": "6612",
  "section": "L",
  "name": "Security and commodity contracts brokerage",
  "parentCode": "661"
 },
 {
  "level": "Class",
  "code": "6619",
  "section": "L",
  "name": "Other activities auxiliary to financial service activities, except insurance and pension funding",
  "parentCode": "661"
 },
 {
  "level": "Class",
  "code": "6621",
  "section": "L",
  "name": "Risk and damage evaluation",
  "parentCode": "662"
 },
 {
  "level": "Class",
  "code": "6622",
  "section": "L",
  "name": "Activities of insurance agents and brokers",
  "parentCode": "662"
 },
 {
  "level": "Class",
  "code": "6629",
  "section": "L",
  "name": "Other activities auxiliary to insurance and pension funding",
  "parentCode": "662"
 },
 {
  "level": "Class",
  "code": "6630",
  "section": "L",
  "name": "Fund management activities",
  "parentCode": "663"
 },
 {
  "level": "Class",
  "code": "6810",
  "section": "M",
  "name": "Real estate activities with own or leased property",
  "parentCode": "681"
 },
 {
  "level": "Class",
  "code": "6821",
  "section": "M",
  "name": "Intermediation service activities for real estate",
  "parentCode": "682"
 },
 {
  "level": "Class",
  "code": "6829",
  "section": "M",
  "name": "Other real estate activities on a fee or contract basis",
  "parentCode": "682"
 },
 {
  "level": "Class",
  "code": "6910",
  "section": "N",
  "name": "Legal activities",
  "parentCode": "691"
 },
 {
  "level": "Class",
  "code": "6920",
  "section": "N",
  "name": "Accounting, bookkeeping and auditing activities; tax consultancy",
  "parentCode": "692"
 },
 {
  "level": "Class",
  "code": "7010",
  "section": "N",
  "name": "Activities of head offices",
  "parentCode": "701"
 },
 {
  "level": "Class",
  "code": "7020",
  "section": "N",
  "name": "Business and other management consultancy activities",
  "parentCode": "702"
 },
 {
  "level": "Class",
  "code": "7110",
  "section": "N",
  "name": "Architectural and engineering, and related technical consultancy activities",
  "parentCode": "711"
 },
 {
  "level": "Class",
  "code": "7120",
  "section": "N",
  "name": "Technical testing and analysis",
  "parentCode": "712"
 },
 {
  "level": "Class",
  "code": "7210",
  "section": "N",
  "name": "Research and experimental development on natural sciences and engineering",
  "parentCode": "721"
 },
 {
  "level": "Class",
  "code": "7220",
  "section": "N",
  "name": "Research and experimental development on social sciences and humanities",
  "parentCode": "722"
 },
 {
  "level": "Class",
  "code": "7310",
  "section": "N",
  "name": "Advertising activities",
  "parentCode": "731"
 },
 {
  "level": "Class",
  "code": "7320",
  "section": "N",
  "name": "Market research and public opinion polling activities",
  "parentCode": "732"
 },
 {
  "level": "Class",
  "code": "7330",
  "section": "N",
  "name": "Public relations activities",
  "parentCode": "733"
 },
 {
  "level": "Class",
  "code": "7410",
  "section": "N",
  "name": "Specialized design activities",
  "parentCode": "741"
 },
 {
  "level": "Class",
  "code": "7420",
  "section": "N",
  "name": "Photographic activities",
  "parentCode": "742"
 },
 {
  "level": "Class",
  "code": "7430",
  "section": "N",
  "name": "Translation and interpretation activities",
  "parentCode": "743"
 },
 {
  "level": "Class",
  "code": "7491",
  "section": "N",
  "name": "Patent brokering and marketing service activities",
  "parentCode": "749"
 },
 {
  "level": "Class",
  "code": "7499",
  "section": "N",
  "name": "All other professional, scientific and technical activities n.e.c.",
  "parentCode": "749"
 },
 {
  "level": "Class",
  "code": "7500",
  "section": "N",
  "name": "Veterinary activities",
  "parentCode": "750"
 },
 {
  "level": "Class",
  "code": "7710",
  "section": "O",
  "name": "Rental and leasing of motor vehicles",
  "parentCode": "771"
 },
 {
  "level": "Class",
  "code": "7721",
  "section": "O",
  "name": "Rental and leasing of recreational and sports goods",
  "parentCode": "772"
 },
 {
  "level": "Class",
  "code": "7729",
  "section": "O",
  "name": "Rental and leasing of other personal and household goods",
  "parentCode": "772"
 },
 {
  "level": "Class",
  "code": "7730",
  "section": "O",
  "name": "Rental and leasing of other machinery, equipment and tangible goods",
  "parentCode": "773"
 },
 {
  "level": "Class",
  "code": "7740",
  "section": "O",
  "name": "Leasing of intellectual property and similar products, except copyrighted works",
  "parentCode": "774"
 },
 {
  "level": "Class",
  "code": "7751",
  "section": "O",
  "name": "Intermediation service activities for rental and leasing of cars, motorhomes and trailers",
  "parentCode": "775"
 },
 {
  "level": "Class",
  "code": "7752",
  "section": "O",
  "name": "Intermediation service activities for rental and leasing of other tangible goods and non-financial intangible assets",
  "parentCode": "775"
 },
 {
  "level": "Class",
  "code": "7810",
  "section": "O",
  "name": "Activities of employment placement agencies",
  "parentCode": "781"
 },
 {
  "level": "Class",
  "code": "7820",
  "section": "O",
  "name": "Temporary employment agency activities and other human resource provisions",
  "parentCode": "782"
 },
 {
  "level": "Class",
  "code": "7911",
  "section": "O",
  "name": "Travel agency activities",
  "parentCode": "791"
 },
 {
  "level": "Class",
  "code": "7912",
  "section": "O",
  "name": "Tour operator activities",
  "parentCode": "791"
 },
 {
  "level": "Class",
  "code": "7990",
  "section": "O",
  "name": "Other travel related activities",
  "parentCode": "799"
 },
 {
  "level": "Class",
  "code": "8011",
  "section": "O",
  "name": "Investigation and private security activities",
  "parentCode": "801"
 },
 {
  "level": "Class",
  "code": "8019",
  "section": "O",
  "name": "Security activities n.e.c.",
  "parentCode": "801"
 },
 {
  "level": "Class",
  "code": "8110",
  "section": "O",
  "name": "Combined facilities support activities",
  "parentCode": "811"
 },
 {
  "level": "Class",
  "code": "8121",
  "section": "O",
  "name": "General cleaning of buildings",
  "parentCode": "812"
 },
 {
  "level": "Class",
  "code": "8129",
  "section": "O",
  "name": "Other cleaning activities",
  "parentCode": "812"
 },
 {
  "level": "Class",
  "code": "8130",
  "section": "O",
  "name": "Landscape service activities",
  "parentCode": "813"
 },
 {
  "level": "Class",
  "code": "8210",
  "section": "O",
  "name": "Office administrative and support activities",
  "parentCode": "821"
 },
 {
  "level": "Class",
  "code": "8220",
  "section": "O",
  "name": "Activities of call centres",
  "parentCode": "822"
 },
 {
  "level": "Class",
  "code": "8230",
  "section": "O",
  "name": "Organization of conventions and trade shows",
  "parentCode": "823"
 },
 {
  "level": "Class",
  "code": "8240",
  "section": "O",
  "name": "Intermediation service activities for business support activities n.e.c., except financial intermediation",
  "parentCode": "824"
 },
 {
  "level": "Class",
  "code": "8291",
  "section": "O",
  "name": "Activities of collection agencies and credit bureaus",
  "parentCode": "829"
 },
 {
  "level": "Class",
  "code": "8292",
  "section": "O",
  "name": "Packaging activities",
  "parentCode": "829"
 },
 {
  "level": "Class",
  "code": "8299",
  "section": "O",
  "name": "Other business support service activities n.e.c.",
  "parentCode": "829"
 },
 {
  "level": "Class",
  "code": "8411",
  "section": "P",
  "name": "General public administration activities",
  "parentCode": "841"
 },
 {
  "level": "Class",
  "code": "8412",
  "section": "P",
  "name": "Regulation of the activities of providing health care, education, cultural services and other social services, excluding social security and environment",
  "parentCode": "841"
 },
 {
  "level": "Class",
  "code": "8413",
  "section": "P",
  "name": "Regulation of the activities of providing environmental services",
  "parentCode": "841"
 },
 {
  "level": "Class",
  "code": "8414",
  "section": "P",
  "name": "Regulation of and contribution to more efficient operation of businesses",
  "parentCode": "841"
 },
 {
  "level": "Class",
  "code": "8421",
  "section": "P",
  "name": "Foreign affairs",
  "parentCode": "842"
 },
 {
  "level": "Class",
  "code": "8422",
  "section": "P",
  "name": "Defence activities",
  "parentCode": "842"
 },
 {
  "level": "Class",
  "code": "8423",
  "section": "P",
  "name": "Public order and safety activities",
  "parentCode": "842"
 },
 {
  "level": "Class",
  "code": "8430",
  "section": "P",
  "name": "Compulsory social security activities",
  "parentCode": "843"
 },
 {
  "level": "Class",
  "code": "8510",
  "section": "Q",
  "name": "Pre-primary education",
  "parentCode": "851"
 },
 {
  "level": "Class",
  "code": "8520",
  "section": "Q",
  "name": "Primary education",
  "parentCode": "852"
 },
 {
  "level": "Class",
  "code": "8531",
  "section": "Q",
  "name": "General secondary education",
  "parentCode": "853"
 },
 {
  "level": "Class",
  "code": "8532",
  "section": "Q",
  "name": "Vocational secondary education",
  "parentCode": "853"
 },
 {
  "level": "Class",
  "code": "8533",
  "section": "Q",
  "name": "Post-secondary non-tertiary education",
  "parentCode": "853"
 },
 {
  "level": "Class",
  "code": "8540",
  "section": "Q",
  "name": "Tertiary education",
  "parentCode": "854"
 },
 {
  "level": "Class",
  "code": "8551",
  "section": "Q",
  "name": "Sports and recreation education",
  "parentCode": "855"
 },
 {
  "level": "Class",
  "code": "8552",
  "section": "Q",
  "name": "Cultural education",
  "parentCode": "855"
 },
 {
  "level": "Class",
  "code": "8553",
  "section": "Q",
  "name": "Driving school activities",
  "parentCode": "855"
 },
 {
  "level": "Class",
  "code": "8559",
  "section": "Q",
  "name": "Other education n.e.c.",
  "parentCode": "855"
 },
 {
  "level": "Class",
  "code": "8561",
  "section": "Q",
  "name": "Intermediation service activities for courses and tutors",
  "parentCode": "856"
 },
 {
  "level": "Class",
  "code": "8569",
  "section": "Q",
  "name": "Other educational support activities",
  "parentCode": "856"
 },
 {
  "level": "Class",
  "code": "8610",
  "section": "R",
  "name": "Hospital activities",
  "parentCode": "861"
 },
 {
  "level": "Class",
  "code": "8620",
  "section": "R",
  "name": "Medical and dental practice activities",
  "parentCode": "862"
 },
 {
  "level": "Class",
  "code": "8691",
  "section": "R",
  "name": "Intermediation service activities for medical, dental, and other human health services",
  "parentCode": "869"
 },
 {
  "level": "Class",
  "code": "8699",
  "section": "R",
  "name": "Other human health activities n.e.c",
  "parentCode": "869"
 },
 {
  "level": "Class",
  "code": "8710",
  "section": "R",
  "name": "Residential nursing care activities",
  "parentCode": "871"
 },
 {
  "level": "Class",
  "code": "8720",
  "section": "R",
  "name": "Residential care activities for persons living with or having a diagnosis of a mental illness or substance abuse",
  "parentCode": "872"
 },
 {
  "level": "Class",
  "code": "8730",
  "section": "R",
  "name": "Residential care activities for older persons or persons with physical disabilities",
  "parentCode": "873"
 },
 {
  "level": "Class",
  "code": "8791",
  "section": "R",
  "name": "Intermediation service activities for residential care activities",
  "parentCode": "879"
 },
 {
  "level": "Class",
  "code": "8799",
  "section": "R",
  "name": "Other residential care activities n.e.c.",
  "parentCode": "879"
 },
 {
  "level": "Class",
  "code": "8810",
  "section": "R",
  "name": "Social work activities without accommodation for older persons or persons with disabilities",
  "parentCode": "881"
 },
 {
  "level": "Class",
  "code": "8890",
  "section": "R",
  "name": "Other social work activities without accommodation",
  "parentCode": "889"
 },
 {
  "level": "Class",
  "code": "9011",
  "section": "S",
  "name": "Literary creation and musical composition activities",
  "parentCode": "901"
 },
 {
  "level": "Class",
  "code": "9012",
  "section": "S",
  "name": "Visual arts creation activities",
  "parentCode": "901"
 },
 {
  "level": "Class",
  "code": "9013",
  "section": "S",
  "name": "Other arts creation activities",
  "parentCode": "901"
 },
 {
  "level": "Class",
  "code": "9020",
  "section": "S",
  "name": "Activities of performing arts",
  "parentCode": "902"
 },
 {
  "level": "Class",
  "code": "9031",
  "section": "S",
  "name": "Operation of arts facilities and sites",
  "parentCode": "903"
 },
 {
  "level": "Class",
  "code": "9039",
  "section": "S",
  "name": "Other support activities to arts creation and performing arts",
  "parentCode": "903"
 },
 {
  "level": "Class",
  "code": "9111",
  "section": "S",
  "name": "Library activities",
  "parentCode": "911"
 },
 {
  "level": "Class",
  "code": "9112",
  "section": "S",
  "name": "Archive activities",
  "parentCode": "911"
 },
 {
  "level": "Class",
  "code": "9121",
  "section": "S",
  "name": "Museum and collection activities",
  "parentCode": "912"
 },
 {
  "level": "Class",
  "code": "9122",
  "section": "S",
  "name": "Historical site and monument activities",
  "parentCode": "912"
 },
 {
  "level": "Class",
  "code": "9130",
  "section": "S",
  "name": "Conservation, restoration and other support activities for cultural heritage",
  "parentCode": "913"
 },
 {
  "level": "Class",
  "code": "9141",
  "section": "S",
  "name": "Botanical and zoological garden activities",
  "parentCode": "914"
 },
 {
  "level": "Class",
  "code": "9142",
  "section": "S",
  "name": "Nature reserve activities",
  "parentCode": "914"
 },
 {
  "level": "Class",
  "code": "9200",
  "section": "S",
  "name": "Gambling and betting activities",
  "parentCode": "920"
 },
 {
  "level": "Class",
  "code": "9311",
  "section": "S",
  "name": "Operation of sports facilities",
  "parentCode": "931"
 },
 {
  "level": "Class",
  "code": "9312",
  "section": "S",
  "name": "Activities of sports clubs",
  "parentCode": "931"
 },
 {
  "level": "Class",
  "code": "9319",
  "section": "S",
  "name": "Other sports activities",
  "parentCode": "931"
 },
 {
  "level": "Class",
  "code": "9321",
  "section": "S",
  "name": "Activities of amusement parks and theme parks",
  "parentCode": "932"
 },
 {
  "level": "Class",
  "code": "9329",
  "section": "S",
  "name": "Other amusement and recreation activities",
  "parentCode": "932"
 },
 {
  "level": "Class",
  "code": "9411",
  "section": "T",
  "name": "Activities of business and employers membership organizations",
  "parentCode": "941"
 },
 {
  "level": "Class",
  "code": "9412",
  "section": "T",
  "name": "Activities of professional membership organizations",
  "parentCode": "941"
 },
 {
  "level": "Class",
  "code": "9420",
  "section": "T",
  "name": "Activities of trade unions",
  "parentCode": "942"
 },
 {
  "level": "Class",
  "code": "9491",
  "section": "T",
  "name": "Activities of religious organizations",
  "parentCode": "949"
 },
 {
  "level": "Class",
  "code": "9492",
  "section": "T",
  "name": "Activities of political organizations",
  "parentCode": "949"
 },
 {
  "level": "Class",
  "code": "9499",
  "section": "T",
  "name": "Activities of other membership organizations n.e.c.",
  "parentCode": "949"
 },
 {
  "level": "Class",
  "code": "9510",
  "section": "T",
  "name": "Repair and maintenance of computers and communication equipment",
  "parentCode": "951"
 },
 {
  "level": "Class",
  "code": "9521",
  "section": "T",
  "name": "Repair and maintenance of consumer electronics",
  "parentCode": "952"
 },
 {
  "level": "Class",
  "code": "9522",
  "section": "T",
  "name": "Repair and maintenance of household appliances and home and garden equipment",
  "parentCode": "952"
 },
 {
  "level": "Class",
  "code": "9523",
  "section": "T",
  "name": "Repair and maintenance of footwear and leather goods",
  "parentCode": "952"
 },
 {
  "level": "Class",
  "code": "9524",
  "section": "T",
  "name": "Repair and maintenance of furniture and home furnishings",
  "parentCode": "952"
 },
 {
  "level": "Class",
  "code": "9529",
  "section": "T",
  "name": "Repair and maintenance of other personal and household goods",
  "parentCode": "952"
 },
 {
  "level": "Class",
  "code": "9531",
  "section": "T",
  "name": "Repair and maintenance of motor vehicles",
  "parentCode": "953"
 },
 {
  "level": "Class",
  "code": "9532",
  "section": "T",
  "name": "Repair and maintenance of motorcycles",
  "parentCode": "953"
 },
 {
  "level": "Class",
  "code": "9540",
  "section": "T",
  "name": "Intermediation service activities for repair and maintenance of computers, personal and household goods, and motor vehicles and motorcycles",
  "parentCode": "954"
 },
 {
  "level": "Class",
  "code": "9610",
  "section": "T",
  "name": "Washing and cleaning of textile and fur products",
  "parentCode": "961"
 },
 {
  "level": "Class",
  "code": "9621",
  "section": "T",
  "name": "Hairdressing and barber activities",
  "parentCode": "962"
 },
 {
  "level": "Class",
  "code": "9622",
  "section": "T",
  "name": "Beauty care and other beauty treatment activities",
  "parentCode": "962"
 },
 {
  "level": "Class",
  "code": "9623",
  "section": "T",
  "name": "Day spa, sauna and steam bath activities",
  "parentCode": "962"
 },
 {
  "level": "Class",
  "code": "9630",
  "section": "T",
  "name": "Funeral and related activities",
  "parentCode": "963"
 },
 {
  "level": "Class",
  "code": "9640",
  "section": "T",
  "name": "Intermediation service activities for personal services",
  "parentCode": "964"
 },
 {
  "level": "Class",
  "code": "9690",
  "section": "T",
  "name": "Other personal service activities n.e.c.",
  "parentCode": "969"
 },
 {
  "level": "Class",
  "code": "9700",
  "section": "U",
  "name": "Activities of households as employers of domestic personnel",
  "parentCode": "970"
 },
 {
  "level": "Class",
  "code": "9810",
  "section": "U",
  "name": "Undifferentiated goods-producing activities of private households for own use",
  "parentCode": "981"
 },
 {
  "level": "Class",
  "code": "9820",
  "section": "U",
  "name": "Undifferentiated service-producing activities of private households for own use",
  "parentCode": "982"
 },
 {
  "level": "Class",
  "code": "9900",
  "section": "V",
  "name": "Activities of extraterritorial organizations and bodies",
  "parentCode": "990"
 }
];

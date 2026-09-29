// Phase 7 — les noms de lieux dans la langue du joueur.
//
// Les états de la carte mondiale portent des noms anglais d'aujourd'hui
// (« Warsaw », « Kyiv », « Rivne »). Test G : la fiche de bataille disait
// « Warsaw » dans une partie en français. Pour le français, la forme française
// usuelle, et pour les lieux qui en avaient une autre en 1936, celle de l'époque
// (Wilno, Lwów, Kovno, Stalino). Un lieu absent de la table garde son nom.
// Import-free.

const FRENCH = Object.freeze({
  // Pologne et Baltes
  Warsaw: "Varsovie", Krakow: "Cracovie", Kraków: "Cracovie", Lviv: "Lwów", Rivne: "Rovno", Hrodna: "Grodno", Grodno: "Grodno",
  Brest: "Brest-Litovsk", Vilnius: "Wilno", Kaunas: "Kovno", Klaipėda: "Memel", Klaipeda: "Memel", Poznan: "Poznań",
  Gdansk: "Dantzig", Gdańsk: "Dantzig", Lodz: "Łódź", Lublin: "Lublin", Bialystok: "Białystok", Katowice: "Katowice",
  Riga: "Riga", Tallinn: "Tallinn", Daugavpils: "Dvinsk", Tartu: "Dorpat",
  // Union soviétique
  Moscow: "Moscou", "Saint Petersburg": "Léningrad", Kyiv: "Kiev", Kharkiv: "Kharkov", Odesa: "Odessa", Odessa: "Odessa",
  Donetsk: "Stalino", Dnipro: "Dniepropetrovsk", Zaporizhzhia: "Zaporojie", Mahilyow: "Moguilev", Homel: "Gomel",
  Vitebsk: "Vitebsk", Minsk: "Minsk", Smolensk: "Smolensk", Pskov: "Pskov", Novgorod: "Novgorod", Volgograd: "Stalingrad",
  Samara: "Kouïbychev", "Nizhny Novgorod": "Gorki", Yekaterinburg: "Sverdlovsk", Tbilisi: "Tiflis", Baku: "Bakou",
  Yerevan: "Erevan", Chisinau: "Chișinău", Vyborg: "Viipuri", Murmansk: "Mourmansk", Arkhangelsk: "Arkhangelsk",
  Voronezh: "Voronej", Orël: "Orel", Kursk: "Koursk", "Bila Tserkva": "Belaïa Tserkov", Chernivtsi: "Czernowitz",
  Vladivostok: "Vladivostok", Irkutsk: "Irkoutsk", Yakutsk: "Iakoutsk", Novosibirsk: "Novossibirsk", Tashkent: "Tachkent",
  // Europe
  London: "Londres", Berlin: "Berlin", Vienna: "Vienne", Prague: "Prague", Budapest: "Budapest", Bucharest: "Bucarest",
  Belgrade: "Belgrade", Sofia: "Sofia", Athens: "Athènes", Rome: "Rome", Milan: "Milan", Naples: "Naples", Venice: "Venise",
  Turin: "Turin", Florence: "Florence", Madrid: "Madrid", Barcelona: "Barcelone", Seville: "Séville", Lisbon: "Lisbonne",
  Brussels: "Bruxelles", Antwerp: "Anvers", Amsterdam: "Amsterdam", "The Hague": "La Haye", Copenhagen: "Copenhague",
  Stockholm: "Stockholm", Oslo: "Oslo", Helsinki: "Helsingfors", Munich: "Munich", Cologne: "Cologne", Hamburg: "Hambourg",
  Dresden: "Dresde", Kaliningrad: "Königsberg", Wroclaw: "Breslau", Wrocław: "Breslau", Szczecin: "Stettin", Istanbul: "Istanbul",
  Ankara: "Ankara", Bratislava: "Presbourg", Ljubljana: "Ljubljana", Zagreb: "Zagreb", Tirana: "Tirana", Geneva: "Genève",
  Bern: "Berne", Zurich: "Zurich", Dublin: "Dublin", Edinburgh: "Édimbourg",
  // Ailleurs
  Beijing: "Pékin", Shanghai: "Shanghai", Nanjing: "Nankin", Tokyo: "Tokyo", Cairo: "Le Caire", Algiers: "Alger",
  Tunis: "Tunis", Rabat: "Rabat", Tangier: "Tanger", Tehran: "Téhéran", Baghdad: "Bagdad", Damascus: "Damas",
  Jerusalem: "Jérusalem", Delhi: "Delhi", Mumbai: "Bombay", Kolkata: "Calcutta", Chennai: "Madras", Addis: "Addis-Abeba",
  "Addis Ababa": "Addis-Abeba", Manama: "Manama", "Mexico City": "Mexico", "New York": "New York", Washington: "Washington",
});

// Le nom d'un lieu dans `language` (fr, ou tel quel). Un nom composé garde ses
// parties connues (« Kyiv Oblast » → « Kiev Oblast »).
export const placeNameFor = (name, language = "en") => {
  const raw = String(name ?? "").trim();
  if (!raw || !/^fr\b/i.test(String(language || ""))) return raw;
  if (FRENCH[raw]) return FRENCH[raw];
  const first = raw.split(/\s+/)[0];
  return FRENCH[first] ? `${FRENCH[first]}${raw.slice(first.length)}` : raw;
};

export const FRENCH_PLACE_NAMES = FRENCH;

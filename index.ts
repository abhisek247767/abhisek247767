import { writeFileSync, readFileSync, existsSync } from "fs";
import process from "process";

function calculateDays({ birthday }: { birthday: Date }): string {
  const today = new Date();
  const nextBirthday = new Date(
    today.getFullYear(),
    birthday.getMonth(),
    birthday.getDate()
  );

  if (today > nextBirthday) {
    nextBirthday.setFullYear(today.getFullYear() + 1);
  }

  const diff = nextBirthday.getTime() - today.getTime();
  const daysLeft = Math.floor(diff / (1000 * 3600 * 24));

  let message: string;

if (daysLeft > 1) {
  message = `<h3 align="center">🎉 Only <strong>${daysLeft} days</strong> left until <em>Abhisek </em>'s birthday! 🎂</h3>`;
} else if (daysLeft === 1) {
  message = `<h3 align="center">⏳ Just <strong>1 day</strong> left until <em>Abhisek </em>'s birthday! 🥳</h3>`;
} else {
  message = `<h3 align="center">🎊 <strong>Today is Abhisek Roy's nirthday!</strong> ✨🎉 Wish him well! 🥳</h3>`;
}

  const readmePath = "README.md";

  if (!existsSync(readmePath)) {
    console.error("README.md not found.");
    process.exit(1);
  }

  const readmeContent = readFileSync(readmePath, "utf-8");
  const markerStart = "<!-- BIRTHDAY_MESSAGE_START -->";
  const markerEnd = "<!-- BIRTHDAY_MESSAGE_END -->";
  const regex = new RegExp(`${markerStart}[\\s\\S]*${markerEnd}`, "g");

  const newContent = `${markerStart}\n${message}\n${markerEnd}`;
  const updatedContent = readmeContent.match(regex)
    ? readmeContent.replace(regex, newContent)
    : `${readmeContent}\n\n${newContent}`;

  writeFileSync(readmePath, updatedContent);

  return "Done";
}

try {
  // Month is 0-based: February = 1
  console.log(calculateDays({ birthday: new Date(2002, 1, 22) }));
} catch (error) {
  console.error(error);
  process.exit(1);
}

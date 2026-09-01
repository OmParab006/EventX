-- MySQL dump 10.13  Distrib 8.0.41, for Win64 (x86_64)
--
-- Host: localhost    Database: event_management
-- ------------------------------------------------------
-- Server version	8.0.41

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `events`
--

DROP TABLE IF EXISTS `events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `events` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(150) NOT NULL,
  `description` text,
  `category` varchar(50) DEFAULT 'Technical',
  `venue` varchar(200) NOT NULL,
  `event_date` datetime NOT NULL,
  `max_participants` int NOT NULL,
  `fee` decimal(10,2) DEFAULT '0.00',
  `created_by` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `events_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `events`
--

LOCK TABLES `events` WRITE;
/*!40000 ALTER TABLE `events` DISABLE KEYS */;
INSERT INTO `events` VALUES (1,'Annual Day','Anuual Day Celebration','Technical','Ground','2026-09-20 12:00:00',100,0.00,3,'2026-08-14 08:04:53'),(2,'Anuual sports day','sports ceremony','Technical','college ground','2026-11-05 09:00:00',100,50.00,3,'2026-08-14 08:48:40'),(4,'test event','Event X','Technical','Ground','2026-11-12 11:00:00',50,0.00,3,'2026-08-21 05:03:13'),(5,'Ai Workshop','Workshop on AI','Technical','Seminar hall','2026-12-25 09:30:00',100,30.00,3,'2026-08-21 08:30:58');
/*!40000 ALTER TABLE `events` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `payments`
--

DROP TABLE IF EXISTS `payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `registration_id` int NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `payment_status` enum('PENDING','PAID','FAILED') DEFAULT 'PENDING',
  `payment_gateway` varchar(50) DEFAULT 'RAZORPAY',
  `razorpay_order_id` varchar(100) DEFAULT NULL,
  `transaction_id` varchar(200) DEFAULT NULL,
  `paid_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `registration_id` (`registration_id`),
  CONSTRAINT `payments_ibfk_1` FOREIGN KEY (`registration_id`) REFERENCES `registrations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `payments`
--

LOCK TABLES `payments` WRITE;
/*!40000 ALTER TABLE `payments` DISABLE KEYS */;
INSERT INTO `payments` VALUES (1,2,50.00,'PENDING','RAZORPAY','order_TQkB3gxI1IQNsf',NULL,NULL,'2026-08-17 06:49:33'),(2,2,50.00,'PENDING','RAZORPAY','order_TQkOJR2zDWax2U',NULL,NULL,'2026-08-17 07:02:06'),(3,2,50.00,'PENDING','RAZORPAY','order_TQkgMpJdFNfEaa',NULL,NULL,'2026-08-17 07:19:12'),(4,2,50.00,'PENDING','RAZORPAY','order_TQkkuH0t4UheNt',NULL,NULL,'2026-08-17 07:23:30'),(5,2,50.00,'PAID','RAZORPAY','order_TQkrC0Pwoy4VNT','pay_TQkxUdqNJsfgKF','2026-08-17 07:35:39','2026-08-17 07:29:27'),(6,2,50.00,'PAID','RAZORPAY','order_TSJAcsvC6516uW','pay_TSJArF03xjCieG','2026-08-21 05:43:13','2026-08-21 05:42:23'),(7,5,30.00,'PAID','RAZORPAY','order_TSM3flXYGswPjc','pay_TSM3lKaV7dzRUn','2026-08-21 08:32:14','2026-08-21 08:31:53'),(8,2,50.00,'PENDING','RAZORPAY','order_TTwTybUoYgxglG',NULL,NULL,'2026-08-25 08:48:48'),(9,2,50.00,'PAID','UPI_VIVA_SIMULATOR','order_sim_1787647741234','TXN_TEST_1787647741234_7122','2026-08-25 08:49:01','2026-08-25 08:49:01');
/*!40000 ALTER TABLE `payments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `registrations`
--

DROP TABLE IF EXISTS `registrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `registrations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `student_id` int NOT NULL,
  `event_id` int NOT NULL,
  `registration_status` enum('PENDING_PAYMENT','CONFIRMED','CANCELLED') DEFAULT 'CONFIRMED',
  `payment_status` enum('NOT_REQUIRED','PENDING','PAID','FAILED') DEFAULT 'NOT_REQUIRED',
  `registered_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `student_id` (`student_id`,`event_id`),
  KEY `event_id` (`event_id`),
  CONSTRAINT `registrations_ibfk_1` FOREIGN KEY (`student_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `registrations_ibfk_2` FOREIGN KEY (`event_id`) REFERENCES `events` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `registrations`
--

LOCK TABLES `registrations` WRITE;
/*!40000 ALTER TABLE `registrations` DISABLE KEYS */;
INSERT INTO `registrations` VALUES (1,1,1,'CONFIRMED','NOT_REQUIRED','2026-08-25 08:48:30'),(2,1,2,'CANCELLED','PAID','2026-08-25 08:48:47'),(4,1,4,'CANCELLED','NOT_REQUIRED','2026-08-21 05:04:44'),(5,1,5,'CANCELLED','PAID','2026-08-21 08:31:53');
/*!40000 ALTER TABLE `registrations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `email` varchar(150) NOT NULL,
  `password` varchar(255) NOT NULL,
  `role` enum('student','teacher','admin') NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (1,'Test Student','student@test.com','$2b$10$Fg0yU9yBxrEokyYmyEplIegO2bkjc7hb7sbkD/iw/47qC5LUgdtOO','student','2026-08-11 09:21:07'),(2,'Test Student 2','student2@test.com','$2b$10$Z13kPiGyBc2Zm/kXY4eXduJnB6Q2gIrf.gcyivmiDXc/4fr8yyw6S','student','2026-08-11 09:30:15'),(3,'Test Teacher','teacher@test.com','$2b$10$0esxxBmw52auioMeRuPNLuUkDM.ey8aY7Ou8q3Bc/kupkeyh7xH9i','teacher','2026-08-12 09:17:54'),(8,'Yashu','yashu@gmail.com','$2b$10$Fg0yU9yBxrEokyYmyEplIegO2bkjc7hb7sbkD/iw/47qC5LUgdtOO','student','2026-08-21 08:43:35'),(12,'Om','om@gmail.com','$2b$10$/Vn8oeDn5LT4r89.BCDYI.m8pebFVRD.wcIxGXa8hFUmo41yvBJj2','teacher','2026-08-21 09:01:28'),(13,'Prof. Rajesh Sharma (Faculty Admin)','admin@eventx.com','$2b$10$WxhAOHQv9C4C0uRWQLwNK.L.IS3hc4ty86V0ybMSZ35kwA6rp9pvW','teacher','2026-08-24 08:41:25'),(14,'Aditiya','aditiya@gmail.com','$2b$10$B9r99/P1y7wW/JTYijmbvexQ.qENqjlshVbqeBV0lRhNTVqZwEs.S','admin','2026-08-25 08:10:43');
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;
--
-- Table structure for table `password_reset_tokens`
--

DROP TABLE IF EXISTS `password_reset_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `password_reset_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `email` varchar(150) NOT NULL,
  `otp_hash` varchar(255) NOT NULL,
  `reset_token_hash` varchar(255) DEFAULT NULL,
  `attempts` int DEFAULT '0',
  `is_used` tinyint(1) DEFAULT '0',
  `expires_at` datetime NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `email` (`email`),
  CONSTRAINT `fk_prt_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-09-01 14:50:00

